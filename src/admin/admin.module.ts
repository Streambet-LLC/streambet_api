import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { UsersModule } from '../users/users.module';
import { BettingModule } from '../betting/betting.module';
import { WalletsModule } from '../wallets/wallets.module';
import { StreamModule } from 'src/stream/stream.module';
import { PlatformPayoutModule } from 'src/platform-payout/platform-payout.module';

@Module({
  imports: [
    UsersModule,
    BettingModule,
    WalletsModule,
    StreamModule,
    PlatformPayoutModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule { }
