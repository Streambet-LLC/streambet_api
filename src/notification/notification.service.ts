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

/**
 * Interface for a single betting round result
 */
interface BettingRound {
  roundName: string;
  status: 'won' | 'lost';
  amount?: number;
  currencyType?: string;
  timestamp: Date;
}

/**
 * Interface for betting summary stored in Redis
 */
interface BettingSummary {
  streamId: string;
  streamName: string;
  userId: string;
  rounds: BettingRound[];
}

@Injectable()
export class NotificationService {
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

  // Redis helpers for betting summary emails
  private readonly BETTING_SUMMARY_PREFIX = 'betting_summary';
  private readonly BETTING_PARTICIPANTS_PREFIX = 'betting_participants';
  private readonly BETTING_SUMMARY_TTL_DAYS = 7;

  private formatCurrencyType(currencyType: string): string {
    return currencyType === CurrencyType.GOLD_COINS
      ? CurrencyTypeText.GOLD_COINS_TEXT
      : CurrencyTypeText.SWEEP_COINS_TEXT;
  }

  private getBettingSummaryTTL(): number {
    return this.configService.get<number>('email.ttls.fullDay') * this.BETTING_SUMMARY_TTL_DAYS;
  }

  async addStreamParticipants(streamId: string, userIds: string[]): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const cacheKey = `${this.BETTING_PARTICIPANTS_PREFIX}:${streamId}`;
      
      if (userIds.length > 0) {
        await redis.sadd(cacheKey, ...userIds);
        await redis.expire(cacheKey, this.getBettingSummaryTTL());
      }
    } catch (e) {
      Logger.error('Failed to add stream participants to Redis', e);
    }
  }

  async getStreamParticipants(streamId: string): Promise<string[]> {
    try {
      const redis = this.redisService.getClient();
      const cacheKey = `${this.BETTING_PARTICIPANTS_PREFIX}:${streamId}`;
      return (await redis.smembers(cacheKey)) || [];
    } catch (e) {
      Logger.error('Failed to get stream participants from Redis', e);
      return [];
    }
  }

  private async clearStreamParticipants(streamId: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      await redis.del(`${this.BETTING_PARTICIPANTS_PREFIX}:${streamId}`);
    } catch (e) {
      Logger.error('Failed to clear stream participants from Redis', e);
    }
  }

  // Stores betting results (win/loss) in Redis using atomic operations
  async addBettingResult(
    streamId: string,
    streamName: string,
    userId: string,
    roundName: string,
    status: 'won' | 'lost',
    amount?: number,
    currencyType?: string,
  ): Promise<void> {
    try {
      // Validate required fields for wins
      if (status === 'won') {
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
          Logger.error(`Invalid amount for win result: ${amount}`);
          return;
        }
        if (!currencyType || typeof currencyType !== 'string' || currencyType.trim() === '') {
          Logger.error(`Invalid currencyType for win result: ${currencyType}`);
          return;
        }
      }

      const redis = this.redisService.getClient();
      const cacheKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}`;
      const metadataKey = `${cacheKey}:metadata`;
      const ttl = this.getBettingSummaryTTL();

      // Atomically store metadata with TTL in single operation (SET NX EX)
      await redis.set(metadataKey, JSON.stringify({ streamId, streamName, userId }), 'EX', ttl, 'NX');

      // Build round data
      const roundData: BettingRound = {
        roundName,
        status,
        ...(status === 'won' && { amount, currencyType }),
        timestamp: new Date(),
      };
      
      // Atomically append round result using RPUSH
      await redis.rpush(cacheKey, JSON.stringify(roundData));
      
      // Extend TTL on each bet to keep data fresh as long as activity continues
      // This ensures the summary remains available throughout an active stream
      await redis.expire(cacheKey, ttl);
    } catch (e) {
      Logger.error(`Failed to add ${status} result to Redis`, e);
    }
  }

  // Convenience wrappers for backward compatibility
  async addWinResult(streamId: string, streamName: string, userId: string, roundName: string, amount: number, currencyType: string): Promise<void> {
    return this.addBettingResult(streamId, streamName, userId, roundName, 'won', amount, currencyType);
  }

  async addLossResult(streamId: string, streamName: string, userId: string, roundName: string): Promise<void> {
    return this.addBettingResult(streamId, streamName, userId, roundName, 'lost');
  }

  // Sends betting summary emails when stream ends. Redis data expires via TTL (7 days).
  async sendStreamBettingSummaryEmails(streamId: string, userIds: string[]): Promise<void> {
    Logger.log(`Sending betting summary emails for stream ${streamId} to ${userIds.length} users`);
    
    const results = await Promise.allSettled(
      userIds.map(userId => this.sendUserBettingSummary(streamId, userId))
    );
    
    await this.clearStreamParticipants(streamId);
    
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      Logger.warn(`${failed}/${userIds.length} summary emails failed for stream ${streamId}`);
    }
    Logger.log(`Completed betting summary emails for stream ${streamId}`);
  }

  private async sendUserBettingSummary(streamId: string, userId: string): Promise<void> {
    const redis = this.redisService.getClient();
    const cacheKey = `${this.BETTING_SUMMARY_PREFIX}:${streamId}:${userId}`;
    const metadataKey = `${cacheKey}:metadata`;

    const [metadataStr, roundsData] = await Promise.all([
      redis.get(metadataKey),
      redis.lrange(cacheKey, 0, -1),
    ]);

    if (!metadataStr || !roundsData?.length) {
      Logger.log(`No betting data for user ${userId} in stream ${streamId}`);
      return;
    }

    const summary: BettingSummary = {
      ...JSON.parse(metadataStr),
      rounds: roundsData.map(str => JSON.parse(str)),
    };

    const receiver = await this.usersService.findUserByUserId(userId);
    const permission = await this.addNotificationPermision(userId);
    
    if (!receiver?.email || !permission?.['emailNotification'] || receiver.email.toLowerCase().endsWith('@example.com')) {
      Logger.log(`Skipping user ${userId}: invalid email or notifications disabled`);
      return;
    }

    const dashboardLink = this.configService.get<string>('email.HOST_URL') || '';
    const formattedRounds = summary.rounds.map(r => ({
      ...r,
      currencyType: r.currencyType ? this.formatCurrencyType(r.currencyType) : undefined,
    }));

    await this.queueService.addEmailJob(
      {
        toAddress: [receiver.email],
        subject: NOTIFICATION_TEMPLATE.EMAIL_BETTING_SUMMARY.TITLE({ streamName: summary.streamName }),
        params: {
          streamName: summary.streamName,
          fullName: receiver.username,
          rounds: formattedRounds,
          dashboardLink: `${dashboardLink}/betting-history`,
        },
      },
      EmailType.BettingStreamSummary,
    );

    Logger.log(`Betting summary email queued for user ${userId}`);
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
}
