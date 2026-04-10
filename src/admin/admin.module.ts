import { forwardRef, Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { UsersModule } from '../users/users.module';
import { BettingModule } from '../betting/betting.module';
import { WalletsModule } from '../wallets/wallets.module';
import { StreamModule } from 'src/stream/stream.module';
import { PlatformPayoutModule } from 'src/platform-payout/platform-payout.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { CreatorModule } from 'src/creator/creator.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { PromoCodeModule } from 'src/promo-code/promo-code.module';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    TypeOrmModule.forFeature([User]),
    BettingModule,
    WalletsModule,
    StreamModule,
    PlatformPayoutModule,
    CreatorModule,
    SubscriptionModule,
    PromoCodeModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
