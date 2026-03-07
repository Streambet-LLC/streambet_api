import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { PrizeOrder } from 'src/prize/entities/prize-order.entity';
import { AutoLockerService } from './auto-locker.service';
import { SentimentRevealService } from './sentiment-reveal.service';
import { ShippingReminderService } from './shipping-reminder.service';
import { EmailsService } from 'src/emails/email.service';

@Module({
  imports: [TypeOrmModule.forFeature([BettingRound, PrizeOrder])],
  providers: [
    AutoLockerService,
    SentimentRevealService,
    ShippingReminderService,
    EmailsService,
  ],
})
export class ScheduledTaskModule {}