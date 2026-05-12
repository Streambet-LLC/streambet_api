import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ReferralService } from 'src/referral/referral.service';
import { ReferralLink } from 'src/referral/referral-link.entity';
import { Follower } from 'src/follower/follower.entity';
import { FollowerService } from 'src/follower/follower.service';
import { PrizeModule } from 'src/prize/prize.module';
import { Transaction } from 'src/wallets/entities/transaction.entity';
import { QueueModule } from 'src/queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, ReferralLink, Follower, Transaction]),
    forwardRef(() => PrizeModule),
    QueueModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, ReferralService, FollowerService],
  exports: [UsersService],
})
export class UsersModule {}
