import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EBAY_MIGRATION_QUEUE } from 'src/common/constants/queue.constants';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { PrizeOrder } from 'src/prize/entities/prize-order.entity';
import { AutoLockerService } from './auto-locker.service';
import { SentimentRevealService } from './sentiment-reveal.service';
import { ShippingReminderService } from './shipping-reminder.service';
import { ReviewReminderService } from './review-reminder.service';
import { EmailsService } from 'src/emails/email.service';
import { ReviewsModule } from 'src/reviews/reviews.module';
import { InboxModule } from 'src/inbox/inbox.module';
import { PrizeConfiguration } from 'src/prize/entities/prize-configuration.entity';
import { PrizeItemEbaySoldListing } from 'src/prize/entities/prize-item-ebay-sold-listing.entity';
import { PrizeItemEbaySyncState } from 'src/prize/entities/prize-item-ebay-sync-state.entity';
import { PrizeModule } from 'src/prize/prize.module';
import { EbayModule } from 'src/integrations/ebay/ebay.module';
import { EbaySoldMarketSyncService } from './ebay-sold-market-sync.service';
import { EbaySoldMarketAdminController } from './ebay-sold-market-admin.controller';
import { PaymentsModule } from 'src/payments/payments.module';
import { AchSettlementReconcilerService } from './ach-settlement-reconciler.service';
import { AchReconcilerAdminController } from './ach-reconciler-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BettingRound,
      PrizeOrder,
      PrizeConfiguration,
      PrizeItemEbaySoldListing,
      PrizeItemEbaySyncState,
    ]),
    ReviewsModule,
    InboxModule,
    PrizeModule,
    PaymentsModule,
    EbayModule,
    BullModule.registerQueue({
      name: EBAY_MIGRATION_QUEUE,
    }),
  ],
  providers: [
    AutoLockerService,
    SentimentRevealService,
    ShippingReminderService,
    ReviewReminderService,
    EbaySoldMarketSyncService,
    AchSettlementReconcilerService,
    EmailsService,
  ],
  controllers: [EbaySoldMarketAdminController, AchReconcilerAdminController],
  exports: [EbaySoldMarketSyncService],
})
export class ScheduledTaskModule {}
