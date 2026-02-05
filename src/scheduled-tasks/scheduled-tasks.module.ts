import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { AutoLockerService } from './auto-locker.service';
import { SentimentRevealService } from './sentiment-reveal.service';

@Module({
  imports: [TypeOrmModule.forFeature([BettingRound])],
  providers: [AutoLockerService, SentimentRevealService],
})
export class ScheduledTaskModule {}