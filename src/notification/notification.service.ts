import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';
import { NOTIFICATION_TEMPLATE } from './notification.templates';
import { EmailsService } from 'src/emails/email.service';
import { EmailType } from 'src/enums/email-type.enum';
import { CurrencyType } from 'src/wallets/entities/transaction.entity';

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
      const userDetails = await this.usersService.findById(userId);
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
      const receiver = await this.usersService.findById(userId);
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
          currencyType === CurrencyType.FREE_TOKENS
            ? 'free token'
            : 'stream coin';
        const emailData = {
          toAddress: [receiverEmail],
          subject,
          params: {
            streamName,
            fullName: receiver.username,
            amount: amount.toLocaleString('en-US'),
            currencyType: updatedCurrencyType,
            roundName,
            dashboardLink,
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
      const receiver = await this.usersService.findById(userId);
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
            dashboardLink,
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
  async sendSMTPForWonFreeCoin(
    userId: string,
    receiverEmail: string,
    username: string,
    streamName: string,
    amount: number,
    roundName: string,
    convertedCoin: string,
    blogPostLink: string,
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

        const emailData = {
          toAddress: [receiverEmail],
          subject,
          params: {
            streamName,
            fullName: username,
            amount: amount.toLocaleString('en-US'),
            roundName,
            convertedCoin,
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
}
