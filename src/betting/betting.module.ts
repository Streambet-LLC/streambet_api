import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stream } from './entities/stream.entity';
import { BettingVariable } from './entities/betting-variable.entity';
import { Bet } from './entities/bet.entity';
import { BettingService } from './betting.service';
import { BettingController } from './betting.controller';
import { BettingGateway } from './betting.gateway';
import { WalletsModule } from '../wallets/wallets.module';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stream, BettingVariable, Bet]),
    WalletsModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [BettingController],
  providers: [BettingService, BettingGateway],
  exports: [BettingService],
})
export class BettingModule {}
