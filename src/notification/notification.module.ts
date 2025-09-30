import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { UsersModule } from 'src/users/users.module';
import { QueueModule } from 'src/queue/queue.module';

@Module({
  imports: [QueueModule, UsersModule],
  controllers: [],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
