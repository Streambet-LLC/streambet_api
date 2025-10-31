import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { formatCurrencyType } from 'src/common/utils/currency-utils';
import { CurrencyTypeText } from 'src/enums/currency.enum';

export interface BettingRound {
  roundName: string;
  status: 'won' | 'lost';
  amount: number;
  currencyType: string;
  timestamp: Date | string;
}

export interface BettingSummary {
  streamId: string;
  streamName: string;
  userId: string;
  rounds: BettingRound[];
}

/**
 * Service for managing betting result summaries stored in Redis.
 * 
 * Architecture:
 * - Individual bet results (wins/losses) are stored in Redis during round calculations
 * - Data is aggregated per user per stream
 * - When a stream ends, summary emails are sent and Redis data is cleaned up
 * - TTL of 7 days ensures data doesn't persist indefinitely if email sending fails
 * 
 * This replaces the previous approach of sending individual emails for each bet result.
 */
@Injectable()
export class BettingSummaryService {
  private readonly logger = new Logger(BettingSummaryService.name);
  private readonly BETTING_SUMMARY_PREFIX = 'betting_summary';
  private readonly BETTING_PARTICIPANTS_PREFIX = 'betting_participants';
  private readonly BETTING_SUMMARY_TTL_DAYS = 7;

  constructor(private readonly redisService: RedisService) {}

  private getBettingSummaryTTL(): number {
    return this.BETTING_SUMMARY_TTL_DAYS * 24 * 60 * 60;
  }

  /**
   * Adds user IDs to the set of stream participants tracked in Redis.
   * @param streamId - The stream ID
   * @param userIds - Array of user IDs who participated in betting
   */
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

  /**
   * Retrieves all user IDs who participated in betting for a stream.
   * @param streamId - The stream ID
   * @returns Array of user IDs
   */
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

  /**
   * Clears the participant tracking for a stream (cleanup operation).
   * Does not throw errors as this is a non-critical cleanup operation.
   * @param streamId - The stream ID
   */
  async clearStreamParticipants(streamId: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      await redis.del(`${this.BETTING_PARTICIPANTS_PREFIX}:${streamId}`);
    } catch (error) {
      this.logger.error(`Failed to clear stream participants for stream ${streamId}`, error);
      // Don't rethrow - this is cleanup operation
    }
  }

  /**
   * Stores a betting result (win or loss) in Redis for later summary email generation.
   * Validates amount and currency type before storing. Invalid data is logged and skipped.
   * @param streamId - The stream ID
   * @param streamName - The stream name
   * @param userId - The user ID
   * @param roundName - The betting round name
   * @param status - Result status ('won' or 'lost')
   * @param amount - The bet amount
   * @param currencyType - The currency type
   */
  async addBettingResult(
    streamId: string,
    streamName: string,
    userId: string,
    roundName: string,
    status: 'won' | 'lost',
    amount: number,
    currencyType: string,
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

  /**
   * Retrieves and formats the betting summary for a user in a stream.
   * Handles corrupted data by cleaning it up and returning null.
   * @param streamId - The stream ID
   * @param userId - The user ID
   * @returns Betting summary with formatted currency types, or null if no data exists
   */
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
      const formattedRounds = rounds.map((round, index) => {
        // Format and validate currency type - handles missing, empty, and invalid enum values
        const formattedCurrency = formatCurrencyType(round.currencyType || '');
        
        if (formattedCurrency === CurrencyTypeText.UNKNOWN_CURRENCY) {
          this.logger.warn(
            `Invalid or missing currencyType in Pick round: "${round.currencyType}" for user ${userId} in stream ${streamId} ` +
            `(round index: ${index}, roundName: ${round.roundName || 'UNKNOWN'}, status: ${round.status || 'UNKNOWN'})`,
          );
        }
        
        return {
          ...round,
          currencyType: formattedCurrency,
        };
      });

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

  /**
   * Deletes the betting summary data for a user in a stream.
   * Called after successfully queuing the summary email.
   * @param streamId - The stream ID
   * @param userId - The user ID
   */
  async deleteBettingSummary(streamId: string, userId: string): Promise<void> {
    const redis = this.redisService.getClient();
    const metadataKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}:metadata`;
    const roundsKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}`;
    await Promise.all([redis.del(metadataKey), redis.del(roundsKey)]);
  }
}
