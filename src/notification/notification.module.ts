import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { EmailsModule } from 'src/emails/email.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [EmailsModule, UsersModule],
  controllers: [],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
