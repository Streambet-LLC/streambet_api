import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';
import { NOTIFICATION_TEMPLATE } from './notification.templates';
import { EmailsService } from 'src/emails/email.service';
import { EmailType } from 'src/enums/email-type.enum';
import {
  CurrencyType,
  CurrencyTypeText,
} from 'src/wallets/entities/transaction.entity';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class NotificationService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly emailsService: EmailsService,
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
            amount: amount.toLocaleString('en-US'),
            currencyType: updatedCurrencyType,
            roundName,
            dashboardLink: `${dashboardLink}/betting-history
`,
          },
        };
        await this.emailsService.sendEmailSMTP(emailData, EmailType.BetWon);

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

        await this.emailsService.sendEmailSMTP(emailData, EmailType.BetLoss);

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

        await this.emailsService.sendEmailSMTP(emailData, EmailType.Welcome);

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

        await this.emailsService.sendEmailSMTP(
          emailData,
          EmailType.PasswordReset,
        );

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

        await this.emailsService.sendEmailSMTP(
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

        await this.emailsService.sendEmailSMTP(
          emailData,
          EmailType.CoinPurchase,
        );

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

        await this.emailsService.sendEmailSMTP(
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
