import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class NotificationService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
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
}
