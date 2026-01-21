import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BetRoundHistory } from './bet-round-history.entity';
import { BetRoundHistoryService } from './bet-round-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([BetRoundHistory])],
  providers: [BetRoundHistoryService],
  exports: [BetRoundHistoryService],
})
export class BetRoundHistoryModule { }
