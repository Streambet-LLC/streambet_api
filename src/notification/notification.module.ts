import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { CacheModule } from '@nestjs/cache-manager';
import { UsersService } from 'src/users/users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { BettingModule } from 'src/betting/betting.module';
import { EmailsModule } from 'src/emails/email.module';
import { BettingService } from 'src/betting/betting.service';
import { Stream } from 'src/stream/entities/stream.entity';
import { BettingVariable } from 'src/betting/entities/betting-variable.entity';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { Bet } from 'src/betting/entities/bet.entity';
import { WalletsService } from 'src/wallets/wallets.service';
import { Wallet } from 'src/wallets/entities/wallet.entity';
import { Transaction } from 'src/wallets/entities/transaction.entity';
import { AuthService } from 'src/auth/auth.service';
import { StreamService } from 'src/stream/stream.service';
import { JwtService } from '@nestjs/jwt';
import { StreamModule } from 'src/stream/stream.module';

@Module({
  imports: [
    EmailsModule,
    BettingModule,
    TypeOrmModule.forFeature([
      User,
      Stream,
      BettingVariable,
      BettingRound,
      Bet,
      Wallet,
      Transaction,
    ]),
    StreamModule
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    UsersService,
    BettingService,
    WalletsService,

    AuthService,
    JwtService,
  ],
})
export class NotificationModule {}
