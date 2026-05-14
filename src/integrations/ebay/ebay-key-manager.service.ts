import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';

interface RapidApiKey {
  key: string;
  index: number;
}

@Injectable()
export class EbayKeyManagerService {
  private readonly logger = new Logger(EbayKeyManagerService.name);
  private readonly keys: RapidApiKey[] = [];
  private readonly REDIS_CURRENT_INDEX_KEY = 'ebay:rapidapi:current-key-index';
  private readonly REDIS_KEY_COOLDOWN_PREFIX = 'ebay:rapidapi:key';

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.loadKeysFromConfig();
  }

  /**
   * Load all RapidAPI keys from environment variables
   * Looks for RAPIDAPI_EBAY_COMPLETED_KEY_1, KEY_2, KEY_3, etc.
   */
  private loadKeysFromConfig(): void {
    let index = 1;
    while (true) {
      const key = this.configService.get<string>(
        `RAPIDAPI_EBAY_COMPLETED_KEY_${index}`,
      );
      if (!key) {
        break; // No more keys found
      }
      this.keys.push({ key, index });
      index++;
    }

    if (this.keys.length === 0) {
      this.logger.warn('No RapidAPI keys configured for eBay completed items');
    } else {
      this.logger.log(
        `Loaded ${this.keys.length} RapidAPI key(s) for eBay completed items`,
      );
    }
  }

  /**
   * Get all available keys
   */
  getAvailableKeys(): RapidApiKey[] {
    return [...this.keys];
  }

  /**
   * Check if any keys are configured
   */
  hasKeys(): boolean {
    return this.keys.length > 0;
  }

  /**
   * Get the current active key based on Redis index
   * Returns null if no keys are available
   */
  async getCurrentKey(): Promise<string | null> {
    if (this.keys.length === 0) {
      return null;
    }

    try {
      const storedIndex = await this.redisService
        .getClient()
        .get(this.REDIS_CURRENT_INDEX_KEY);
      const currentIndex = storedIndex ? parseInt(storedIndex, 10) : 0;

      // Ensure index is within bounds
      const safeIndex = currentIndex % this.keys.length;
      const selectedKey = this.keys[safeIndex];

      this.logger.debug(
        `Current key index: ${safeIndex} (KEY_${selectedKey.index})`,
      );
      return selectedKey.key;
    } catch (error) {
      this.logger.error('Failed to get current key from Redis', error);
      // Fallback to first key
      return this.keys[0].key;
    }
  }

  /**
   * Get the next available key that is not rate-limited
   * Returns null if all keys are rate-limited or none are configured
   */
  async getNextAvailableKey(): Promise<{
    key: string;
    keyIndex: number;
  } | null> {
    if (this.keys.length === 0) {
      return null;
    }

    try {
      const storedIndex = await this.redisService
        .getClient()
        .get(this.REDIS_CURRENT_INDEX_KEY);
      let currentIndex = storedIndex ? parseInt(storedIndex, 10) : 0;

      // Try all keys starting from current + 1
      for (let i = 0; i < this.keys.length; i++) {
        currentIndex = (currentIndex + 1) % this.keys.length;
        const candidate = this.keys[currentIndex];

        // Check if this key is rate-limited
        const isRateLimited = await this.isKeyRateLimited(candidate.index);
        if (!isRateLimited) {
          // Update Redis with new index
          await this.redisService
            .getClient()
            .set(this.REDIS_CURRENT_INDEX_KEY, currentIndex.toString());

          this.logger.log(
            `Rotated to key index ${currentIndex} (KEY_${candidate.index})`,
          );
          return { key: candidate.key, keyIndex: candidate.index };
        } else {
          this.logger.debug(
            `Skipping rate-limited key index ${currentIndex} (KEY_${candidate.index})`,
          );
        }
      }

      this.logger.warn('All RapidAPI keys are currently rate-limited');
      return null;
    } catch (error) {
      this.logger.error('Failed to get next available key', error);
      return null;
    }
  }

  /**
   * Mark a key as rate-limited with optional cooldown period
   * @param keyIndex The key index (1, 2, 3, etc.)
   * @param cooldownSeconds How long to wait before using this key again (default: 60)
   */
  async markKeyRateLimited(
    keyIndex: number,
    cooldownSeconds: number = 60,
  ): Promise<void> {
    try {
      const redisKey = `${this.REDIS_KEY_COOLDOWN_PREFIX}:${keyIndex}:rate-limited-until`;
      const rateLimitedUntil = Date.now() + cooldownSeconds * 1000;

      await this.redisService
        .getClient()
        .setex(redisKey, cooldownSeconds, rateLimitedUntil.toString());

      this.logger.warn(
        `KEY_${keyIndex} marked as rate-limited for ${cooldownSeconds}s`,
      );
    } catch (error) {
      this.logger.error(`Failed to mark KEY_${keyIndex} as rate-limited`, error);
    }
  }

  /**
   * Check if a specific key is currently rate-limited
   * @param keyIndex The key index to check
   */
  async isKeyRateLimited(keyIndex: number): Promise<boolean> {
    try {
      const redisKey = `${this.REDIS_KEY_COOLDOWN_PREFIX}:${keyIndex}:rate-limited-until`;
      const rateLimitedUntil = await this.redisService
        .getClient()
        .get(redisKey);

      if (!rateLimitedUntil) {
        return false;
      }

      const timestamp = parseInt(rateLimitedUntil, 10);
      return Date.now() < timestamp;
    } catch (error) {
      this.logger.error(`Failed to check rate limit for KEY_${keyIndex}`, error);
      return false; // Assume not rate-limited on error
    }
  }

  /**
   * Get all keys with their rate limit status
   * Useful for monitoring/debugging
   */
  async getAllKeyStatuses(): Promise<
    Array<{
      keyIndex: number;
      isRateLimited: boolean;
      rateLimitedUntil: number | null;
    }>
  > {
    const statuses = [];

    for (const keyInfo of this.keys) {
      const isRateLimited = await this.isKeyRateLimited(keyInfo.index);
      let rateLimitedUntil: number | null = null;

      if (isRateLimited) {
        const redisKey = `${this.REDIS_KEY_COOLDOWN_PREFIX}:${keyInfo.index}:rate-limited-until`;
        const timestamp = await this.redisService.getClient().get(redisKey);
        rateLimitedUntil = timestamp ? parseInt(timestamp, 10) : null;
      }

      statuses.push({
        keyIndex: keyInfo.index,
        isRateLimited,
        rateLimitedUntil,
      });
    }

    return statuses;
  }

  /**
   * Reset all rate limits (useful for testing or manual recovery)
   */
  async resetAllRateLimits(): Promise<void> {
    try {
      for (const keyInfo of this.keys) {
        const redisKey = `${this.REDIS_KEY_COOLDOWN_PREFIX}:${keyInfo.index}:rate-limited-until`;
        await this.redisService.getClient().del(redisKey);
      }
      this.logger.log('Reset all key rate limits');
    } catch (error) {
      this.logger.error('Failed to reset rate limits', error);
    }
  }
}
