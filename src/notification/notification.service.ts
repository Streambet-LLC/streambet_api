import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
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
        console.log('expireTime', expireTime);
        await this.cacheManager.set(cacheKey, settings, expireTime);
      }
      return settings;
    }
  }

  async sendSMTPForWonBet(
    userId: string,
    streamName: string,
    amount: number,
    CurrencyType: string,
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

        const subject = NOTIFICATION_TEMPLATE.EMAIL_BET_WON.TITLE({
          streamName,
        });

        const emailData = {
          toAddress: [receiverEmail],
          subject,
          params: {
            streamName,
            username: receiver.username,
            amount,
            CurrencyType,
            roundName,
          },
        };

        await this.emailsService.sendEmailSMTP(emailData, EmailType.BetWon);

        return true;
      }
    } catch (e) {
      Logger.error('unable to send email', e);
    }
  }
}
