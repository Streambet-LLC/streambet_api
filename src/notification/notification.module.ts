import { Module, forwardRef } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { UsersModule } from 'src/users/users.module';
import { QueueModule } from 'src/queue/queue.module';
import { BettingModule } from 'src/betting/betting.module';

@Module({
  imports: [QueueModule, UsersModule, forwardRef(() => BettingModule)],
  controllers: [],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
