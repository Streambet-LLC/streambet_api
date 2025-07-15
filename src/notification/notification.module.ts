import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { CACHE_MODULE_OPTIONS, CacheModule } from '@nestjs/cache-manager';
import { UsersService } from 'src/users/users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';

@Module({
  imports: [
    CacheModule.register({
      ttl: 60, // seconds
      max: 100, // optional
      isGlobal: false,
    }),
    TypeOrmModule.forFeature([User]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, UsersService],
})
export class NotificationModule {}
