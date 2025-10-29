import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';
import { NOTIFICATION_TEMPLATE } from './notification.templates';
import { EmailType } from 'src/enums/email-type.enum';
import { User } from 'src/users/entities/user.entity';
import { QueueService } from 'src/queue/queue.service';
import { CurrencyType, CurrencyTypeText } from 'src/enums/currency.enum';
import { RedisService } from 'src/redis/redis.service';

interface BettingRound {
  roundName: string;
  status: 'won' | 'lost';
  amount?: number;
  currencyType?: string;
  timestamp: Date;
}

interface BettingSummary {
  streamId: string;
  streamName: string;
  userId: string;
  rounds: BettingRound[];
}

@Injectable()
export class NotificationService {
  private readonly BETTING_SUMMARY_PREFIX = 'betting_summary';
  private readonly BETTING_PARTICIPANTS_PREFIX = 'betting_participants';
  private readonly BETTING_SUMMARY_TTL_DAYS = 7;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
    private readonly redisService: RedisService,
  ) {}

  async addNotificationPermision(userId: string) {
    const cacheKey = `user_${userId}_Notification_Settings`;
    const cachedNotificationSettings = await this.cacheManager.get(cacheKey);
    if (cachedNotificationSettings) {
      return cachedNotificationSettings;
    } else {
      const userDetails = await this.usersService.findUserByUserId(userId);
      const settings = userDetails.notificationPreferences;
      if (settings) {
        const expireTime = this.configService.get<number>('email.ttls.fullDay');
        await this.cacheManager.set(cacheKey, settings, expireTime);
      }
      return settings;
    }
  }

  async sendSMTPForWonBet(
    userId: string,
    streamName: string,
    amount: number,
    currencyType: string,
    roundName: string,
  ) {
    try {
      const receiver = await this.usersService.findUserByUserId(userId);
      const receiverEmail = receiver?.email;
      const receiverNotificationPermission =
        await this.addNotificationPermision(userId);
      const dashboardLink =
        this.configService.get<string[]>('email.HOST_URL') || '';
      if (
        receiverNotificationPermission['emailNotification'] &&
        receiverEmail
      ) {
        if (receiverEmail.indexOf('@example.com') !== -1) {
          return true;
        }
        const subject = NOTIFICATION_TEMPLATE.EMAIL_BET_WON.TITLE({
          streamName,
        });
        let updatedCurrencyType =
          currencyType === CurrencyType.GOLD_COINS
            ? CurrencyTypeText.GOLD_COINS_TEXT
            : CurrencyTypeText.SWEEP_COINS_TEXT;
        const emailData = {
          toAddress: [receiverEmail],
          subject,
          params: {
            streamName,
            fullName: receiver.username,
            amount: Math.floor(amount).toLocaleString('en-US'),
            currencyType: updatedCurrencyType,
            roundName,
            dashboardLink: `${dashboardLink}/betting-history
`,
          },
        };

        await this.queueService.addEmailJob(emailData, EmailType.BetWon);

        return true;
      }
    } catch (e) {
      Logger.error('unable to send email', e);
    }
  }
  async sendSMTPForLossBet(
    userId: string,
    streamName: string,
    roundName: string,
  ) {
    try {
      const receiver = await this.usersService.findUserByUserId(userId);
      const receiverEmail = receiver?.email;
      const receiverNotificationPermission =
        await this.addNotificationPermision(userId);
      if (
        receiverNotificationPermission['emailNotification'] &&
        receiverEmail
      ) {
        if (receiverEmail.indexOf('@example.com') !== -1) {
          return true;
        }
        const dashboardLink =
          this.configService.get<string[]>('email.HOST_URL') || '';
        const subject = NOTIFICATION_TEMPLATE.EMAIL_BET_LOSS.TITLE({
          streamName,
        });

        const emailData = {
          toAddress: [receiverEmail],
          subject,
          params: {
            streamName,
            fullName: receiver.username,
            roundName,
            dashboardLink: `${dashboardLink}/betting-history
`,
          },
        };

        await this.queueService.addEmailJob(emailData, EmailType.BetLoss);

        return true;
      }
    } catch (e) {
      Logger.error('unable to send email', e);
    }
  }

  async sendSMTPForWelcome(
    userId: string,
    receiverEmail: string,
    username: string,
  ) {
    try {
      const receiverNotificationPermission =
        await this.addNotificationPermision(userId);
      if (
        receiverNotificationPermission['emailNotification'] &&
        receiverEmail
      ) {
        if (receiverEmail.indexOf('@example.com') !== -1) {
          return true;
        }
        const dashboardLink =
          this.configService.get<string[]>('email.HOST_URL') || '';
        const subject = NOTIFICATION_TEMPLATE.EMAIL_WELCOME.TITLE();
        const emailData = {
          toAddress: [receiverEmail],
          subject,
          params: {
            fullName: username,
            dashboardLink,
            creatorSignUpForm: `https://form.jotform.com/252037370862052`,
          },
        };

        await this.queueService.addEmailJob(emailData, EmailType.Welcome);

        return true;
      }
    } catch (e) {
      Logger.error('unable to send email', e);
    }
  }
  async sendSMTPForPasswordReset(
    receiverEmail: string,
    username: string,
    resetLink: string,
  ) {
    try {
      if (receiverEmail) {
        if (receiverEmail.indexOf('@example.com') !== -1) {
          return true;
        }

        const subject = NOTIFICATION_TEMPLATE.EMAIL_PASSWORD_RESET.TITLE();
        const emailData = {
          toAddress: [receiverEmail],
          subject,
          params: {
            fullName: username,
            resetLink,
          },
        };

        await this.queueService.addEmailJob(emailData, EmailType.PasswordReset);

        return true;
      }
    } catch (e) {
      Logger.error('unable to send email', e);
    }
  }

  //As per client feedback, only one email should be sent to winners (bet_won)
  /*
  async sendSMTPForWonFreeCoin(
    userId: string,
    receiverEmail: string,
    username: string,
    streamName: string,
    amount: number,
    roundName: string,
  ) {
    try {
      const receiverNotificationPermission =
        await this.addNotificationPermision(userId);
      if (
        receiverNotificationPermission['emailNotification'] &&
        receiverEmail
      ) {
        if (receiverEmail.indexOf('@example.com') !== -1) {
          return true;
        }

        const subject = NOTIFICATION_TEMPLATE.EMAIL_FREE_COIN_WON.TITLE({
          streamName,
        });
        const blogPostLink = '#';
        const convertedCoin = Number(amount / 100);
        const emailData = {
          toAddress: [receiverEmail],
          subject,
          params: {
            streamName,
            fullName: username,
            amount: amount.toLocaleString('en-US'),
            roundName,
            convertedCoin: convertedCoin.toLocaleString('en-US'),
            blogPostLink,
          },
        };

        await this.queueService.addEmailJob(
          emailData,
          EmailType.BetWonFreeCoin,
        );

        return true;
      }
    } catch (e) {
      Logger.error('unable to send email', e);
    }
  }
    */

  /**
   * Sends a coin purchase success email notification to the user via SMTP.
   * Checks user notification preferences and skips sending to test/demo emails.
   *
   * @param userId - The ID of the user who purchased coins
   * @param goldCoin - The number of gold coins purchased
   * @param sweepCoin - The number of sweep coins purchased
   * @returns Promise<boolean | void> - Returns true if email sent or skipped, void otherwise
   */
  async sendSMTPForCoinPurchaseSuccess(
    userId: string,
    goldCoins: number,
    sweepCoins: number,
  ) {
    try {
      const receiver = await this.usersService.findUserByUserId(userId);
      const receiverEmail = receiver?.email;
      const receiverNotificationPermission =
        await this.addNotificationPermision(userId);
      if (
        receiverNotificationPermission['emailNotification'] &&
        receiverEmail
      ) {
        if (receiverEmail.indexOf('@example.com') !== -1) {
          return true;
        }

        const subject = NOTIFICATION_TEMPLATE.EMAIL_COIN_PURCHASED.TITLE();

        const emailData = {
          toAddress: [receiverEmail],
          subject,
          params: {
            fullName: receiver.username,
            goldCoins: goldCoins,
            sweepCoins: sweepCoins,
          },
        };

        await this.queueService.addEmailJob(emailData, EmailType.CoinPurchase);

        return true;
      }
    } catch (e) {
      Logger.error('Unable to send coin purchase success mail', e);
    }
  }

  async sendSMTPForAccountVerification(
    userId: string,
    redirect: string,
    token: string,
    user: User,
  ) {
    try {
      const receiver = await this.usersService.findUserByUserId(userId);
      const receiverEmail = receiver?.email;
      const receiverNotificationPermission =
        await this.addNotificationPermision(userId);
      if (
        receiverNotificationPermission['emailNotification'] &&
        receiverEmail
      ) {
        if (receiverEmail.indexOf('@example.com') !== -1) {
          return true;
        }
        const hostUrl = this.configService.get<string>('email.HOST_URL');
        const profileLink = this.configService.get<string>(
          'email.APPLICATION_HOST',
        );

        const host = this.configService.get<string>('email.APPLICATION_HOST');
        const verifyLink = redirect
          ? `${hostUrl}/auth/verify-email?token=${token}&redirect=${redirect}`
          : `${hostUrl}/auth/verify-email?token=${token}`;

        const emailData = {
          subject: 'Activate Email',
          toAddress: [user.email],
          params: {
            host,
            profileLink,
            title: 'Activation Email',
            verifyLink,
            code: '',
            fullName: user.name || user.username,
          },
        };

        await this.queueService.addEmailJob(
          emailData,
          EmailType.AccountVerification,
        );
        return true;
      }
    } catch (e) {
      Logger.error('Unable to send coin purchase success mail', e);
    }
  }

  // ==================== Redis Aggregation Methods ====================

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
      Logger.error(`Failed to add stream participants for stream ${streamId}`, error);
      throw error;
    }
  }

  async getStreamParticipants(streamId: string): Promise<string[]> {
    try {
      const redis = this.redisService.getClient();
      const key = `${this.BETTING_PARTICIPANTS_PREFIX}:${streamId}`;
      return redis.smembers(key);
    } catch (error) {
      Logger.error(`Failed to get stream participants for stream ${streamId}`, error);
      throw error;
    }
  }

  private async clearStreamParticipants(streamId: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      await redis.del(`${this.BETTING_PARTICIPANTS_PREFIX}:${streamId}`);
    } catch (error) {
      Logger.error(`Failed to clear stream participants for stream ${streamId}`, error);
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
    // Validate win results
    if (status === 'won') {
      const numAmount = Number(amount);
      if (!amount || isNaN(numAmount) || !Number.isFinite(numAmount) || numAmount <= 0) {
        Logger.warn(`Invalid win amount for user ${userId}: ${amount}`);
        return;
      }
      if (!currencyType?.trim()) {
        Logger.warn(`Missing currencyType for user ${userId}`);
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
      Logger.error(
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

  async sendStreamBettingSummaryEmails(streamId: string, userIds: string[]): Promise<void> {
    await Promise.allSettled(
      userIds.map((userId) => this.sendUserBettingSummary(streamId, userId)),
    );
    await this.clearStreamParticipants(streamId);
  }

  private async sendUserBettingSummary(streamId: string, userId: string): Promise<void> {
    const redis = this.redisService.getClient();
    const metadataKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}:metadata`;
    const roundsKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}`;

    const [metadataStr, roundsStr] = await Promise.all([
      redis.get(metadataKey),
      redis.lrange(roundsKey, 0, -1),
    ]);

    if (!metadataStr || !roundsStr?.length) return;

    // Parse Redis data with error handling for corrupted data
    let metadata: BettingSummary;
    let rounds: BettingRound[];
    try {
      metadata = JSON.parse(metadataStr);
      rounds = roundsStr.map((r) => JSON.parse(r));
    } catch (error) {
      Logger.error(
        `Corrupted Pick data found for user ${userId} in stream ${streamId} - cleaning up`,
        error,
      );
      // Clean up corrupted data
      await Promise.all([redis.del(metadataKey), redis.del(roundsKey)]).catch((delError) =>
        Logger.error(`Failed to delete corrupted data for user ${userId} in stream ${streamId}`, delError),
      );
      return;
    }

    const receiver = await this.usersService.findUserByUserId(userId);
    if (!receiver?.email || receiver.email.includes('@example.com')) return;

    const receiverNotificationPermission = await this.addNotificationPermision(userId);
    if (!receiverNotificationPermission?.['emailNotification']) return;

    const dashboardLink = this.configService.get<string>('email.HOST_URL') || '';
    const subject = NOTIFICATION_TEMPLATE.EMAIL_BETTING_SUMMARY.TITLE({
      streamName: metadata.streamName,
    });

    const formattedRounds = rounds.map((round) => ({
      roundName: round.roundName,
      status: round.status,
      amount: round.amount,
      currencyType: this.formatCurrencyType(round.currencyType || ''),
    }));

    try {
      await this.queueService.addEmailJob(
        {
          toAddress: [receiver.email],
          subject,
          params: {
            streamName: metadata.streamName,
            fullName: receiver.username,
            rounds: formattedRounds,
            dashboardLink: `${dashboardLink}/betting-history`,
          },
        },
        EmailType.BettingStreamSummary,
      );

      // Only delete Redis keys after successful email queuing
      await Promise.all([redis.del(metadataKey), redis.del(roundsKey)]);
    } catch (error) {
      Logger.error(
        `Failed to queue Pick summary email for user ${userId} in stream ${streamId} - data preserved for retry`,
        error,
      );
      throw error;
    }
  }
}
