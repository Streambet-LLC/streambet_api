import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailsController } from './email.controller';
import { EmailsService } from './email.service';
import { PurchaseNotificationsService } from './purchase-notifications.service';
import { EmailLogService } from './email-log.service';
import { EmailLog } from './entities/email-log.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, EmailLog])],
  controllers: [EmailsController],
  providers: [EmailsService, PurchaseNotificationsService, EmailLogService],
  exports: [EmailsService, PurchaseNotificationsService, EmailLogService],
})
export class EmailsModule {}
