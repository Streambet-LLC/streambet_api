import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { CurrencyType, CurrencyTypeText } from 'src/enums/currency.enum';

export interface BettingRound {
  roundName: string;
  status: 'won' | 'lost';
  amount?: number;
  currencyType?: string;
  timestamp: Date;
}

export interface BettingSummary {
  streamId: string;
  streamName: string;
  userId: string;
  rounds: BettingRound[];
}

@Injectable()
export class BettingSummaryService {
  private readonly logger = new Logger(BettingSummaryService.name);
  private readonly BETTING_SUMMARY_PREFIX = 'betting_summary';
  private readonly BETTING_PARTICIPANTS_PREFIX = 'betting_participants';
  private readonly BETTING_SUMMARY_TTL_DAYS = 7;

  constructor(private readonly redisService: RedisService) {}

  private formatCurrencyType(currencyType: string): string {
    return currencyType === CurrencyType.GOLD_COINS
      ? CurrencyTypeText.GOLD_COINS_TEXT
      : CurrencyTypeText.SWEEP_COINS_TEXT;
  }

  private getBettingSummaryTTL(): number {
    return this.BETTING_SUMMARY_TTL_DAYS * 24 * 60 * 60;
  }

  async addStreamParticipants(
    streamId: string,
    userIds: string[],
  ): Promise<void> {
    if (!userIds.length) return;

    try {
      const redis = this.redisService.getClient();
      const key = `${this.BETTING_PARTICIPANTS_PREFIX}:${streamId}`;
      await redis.sadd(key, ...userIds);
      await redis.expire(key, this.getBettingSummaryTTL());
    } catch (error) {
      this.logger.error(`Failed to add stream participants for stream ${streamId}`, error);
      throw error;
    }
  }

  async getStreamParticipants(streamId: string): Promise<string[]> {
    try {
      const redis = this.redisService.getClient();
      const key = `${this.BETTING_PARTICIPANTS_PREFIX}:${streamId}`;
      return redis.smembers(key);
    } catch (error) {
      this.logger.error(`Failed to get stream participants for stream ${streamId}`, error);
      throw error;
    }
  }

  async clearStreamParticipants(streamId: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      await redis.del(`${this.BETTING_PARTICIPANTS_PREFIX}:${streamId}`);
    } catch (error) {
      this.logger.error(`Failed to clear stream participants for stream ${streamId}`, error);
      // Don't rethrow - this is cleanup operation
    }
  }

  async addBettingResult(
    streamId: string,
    streamName: string,
    userId: string,
    roundName: string,
    status: 'won' | 'lost',
    amount?: number,
    currencyType?: string,
  ): Promise<void> {
    // Validate both win and loss results to prevent storing invalid data
    if (status === 'won' || status === 'lost') {
      // Check that amount is present before converting to Number
      if (amount === undefined || amount === null) {
        this.logger.warn(`Missing amount for user ${userId} with status ${status}`);
        return;
      }

      const numAmount = Number(amount);
      if (isNaN(numAmount) || !Number.isFinite(numAmount) || numAmount <= 0) {
        this.logger.warn(`Invalid amount for user ${userId} with status ${status}: ${amount}`);
        return;
      }

      if (!currencyType?.trim()) {
        this.logger.warn(`Missing currencyType for user ${userId} with status ${status}`);
        return;
      }
    }

    try {
      const redis = this.redisService.getClient();
      const ttl = this.getBettingSummaryTTL();
      const metadataKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}:metadata`;
      const roundsKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}`;

      // Store metadata
      await redis.set(metadataKey, JSON.stringify({ streamId, streamName, userId }), 'EX', ttl, 'NX');

      // Store round data
      const round: BettingRound = {
        roundName,
        status,
        timestamp: new Date(),
        amount: Number(amount),
        currencyType,
      };

      await redis.rpush(roundsKey, JSON.stringify(round));
      await redis.expire(roundsKey, ttl);
      await redis.expire(metadataKey, ttl);
    } catch (error) {
      this.logger.error(
        `Failed to add Pick result for user ${userId} in stream ${streamId} (status: ${status})`,
        error,
      );
      throw error;
    }
  }

  async addWinResult(
    streamId: string,
    streamName: string,
    userId: string,
    roundName: string,
    amount: number,
    currencyType: string,
  ): Promise<void> {
    return this.addBettingResult(streamId, streamName, userId, roundName, 'won', amount, currencyType);
  }

  async addLossResult(
    streamId: string,
    streamName: string,
    userId: string,
    roundName: string,
    amount: number,
    currencyType: string,
  ): Promise<void> {
    return this.addBettingResult(streamId, streamName, userId, roundName, 'lost', amount, currencyType);
  }

  async getBettingSummary(streamId: string, userId: string): Promise<BettingSummary | null> {
    const redis = this.redisService.getClient();
    const metadataKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}:metadata`;
    const roundsKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}`;

    const [metadataStr, roundsStr] = await Promise.all([
      redis.get(metadataKey),
      redis.lrange(roundsKey, 0, -1),
    ]);

    if (!metadataStr || !roundsStr?.length) return null;

    // Parse Redis data with error handling for corrupted data
    try {
      const metadata = JSON.parse(metadataStr);
      const rounds = roundsStr.map((r) => JSON.parse(r));
      
      // Format currency types for display
      const formattedRounds = rounds.map((round) => ({
        ...round,
        currencyType: this.formatCurrencyType(round.currencyType || ''),
      }));

      return {
        ...metadata,
        rounds: formattedRounds,
      };
    } catch (error) {
      this.logger.error(
        `Corrupted Pick data found for user ${userId} in stream ${streamId} - cleaning up`,
        error,
      );
      // Clean up corrupted data
      await Promise.all([redis.del(metadataKey), redis.del(roundsKey)]).catch((delError) =>
        this.logger.error(`Failed to delete corrupted data for user ${userId} in stream ${streamId}`, delError),
      );
      return null;
    }
  }

  async deleteBettingSummary(streamId: string, userId: string): Promise<void> {
    const redis = this.redisService.getClient();
    const metadataKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}:metadata`;
    const roundsKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}`;
    await Promise.all([redis.del(metadataKey), redis.del(roundsKey)]);
  }
}
