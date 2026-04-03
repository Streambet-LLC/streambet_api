import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConciergeController } from './concierge.controller';
import { ConciergeService } from './concierge.service';
import { ConciergeRequest } from './entities/concierge-request.entity';
import { User } from '../users/entities/user.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConciergeRequest, User]),
    forwardRef(() => NotificationModule),
  ],
  controllers: [ConciergeController],
  providers: [ConciergeService],
  exports: [ConciergeService],
})
export class ConciergeModule {}
