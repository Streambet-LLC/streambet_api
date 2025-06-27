import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BettingVariable } from './entities/betting-variable.entity';
import { BettingRound } from './entities/betting-round.entity';
import { Bet } from './entities/bet.entity';
import { BettingService } from './betting.service';
import { BettingController } from './betting.controller';
import { BettingGateway } from './betting.gateway';
import { WalletsModule } from '../wallets/wallets.module';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { Stream } from 'src/stream/entities/stream.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BettingVariable, BettingRound, Bet, Stream]),
    WalletsModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [BettingController],
  providers: [BettingService, BettingGateway],
  exports: [BettingService],
})
export class BettingModule {}
