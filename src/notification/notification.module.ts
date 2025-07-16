import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { CACHE_MODULE_OPTIONS, CacheModule } from '@nestjs/cache-manager';
import { UsersService } from 'src/users/users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { EmailsService } from 'src/emails/email.service';
import { BettingModule } from 'src/betting/betting.module';
import { EmailsModule } from 'src/emails/email.module';
import { BettingService } from 'src/betting/betting.service';
import { Stream } from 'src/stream/entities/stream.entity';
import { BettingVariable } from 'src/betting/entities/betting-variable.entity';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { Bet } from 'src/betting/entities/bet.entity';
import { WalletsService } from 'src/wallets/wallets.service';
import { BettingGateway } from 'src/betting/betting.gateway';
import { Wallet } from 'src/wallets/entities/wallet.entity';
import { Transaction } from 'src/wallets/entities/transaction.entity';
import { AuthService } from 'src/auth/auth.service';
import { StreamService } from 'src/stream/stream.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [
    EmailsModule,
    CacheModule.register({
      ttl: 60, // seconds
      max: 100, // optional
      isGlobal: false,
    }),
    TypeOrmModule.forFeature([
      User,
      Stream,
      BettingVariable,
      BettingRound,
      Bet,
      Wallet,
      Transaction,
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    UsersService,
    BettingService,
    WalletsService,
    BettingGateway,
    AuthService,
    JwtService,
    StreamService,
  ],
})
export class NotificationModule {}
