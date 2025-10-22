import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformPayout } from './entities/platform-payout.entity';
import { PlatformPayoutService } from './plaform-payout.service';
import { Stream } from 'src/stream/entities/stream.entity';
import { User } from 'src/users/entities/user.entity';
import { Bet } from 'src/betting/entities/bet.entity';
import { BettingVariable } from 'src/betting/entities/betting-variable.entity';
import { WalletsModule } from 'src/wallets/wallets.module';

@Module({
  imports: [TypeOrmModule.forFeature([
    PlatformPayout,
    Stream,
    User,
    Bet,
    BettingVariable,
  ]),
  forwardRef(() => WalletsModule),
  ],
  providers: [PlatformPayoutService],
  exports: [PlatformPayoutService],
})
export class PlatformPayoutModule { }
