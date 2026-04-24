import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Auction } from '../prize/entities/auction.entity';
import { AuctionBid } from '../prize/entities/auction-bid.entity';
import { PrizeConfiguration } from '../prize/entities/prize-configuration.entity';
import { PrizeItemWatcher } from '../prize/entities/prize-item-watcher.entity';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import { User } from '../users/entities/user.entity';
import { AuctionsService } from './auctions.service';
import { AuctionsPaymentsService } from './auctions-payments.service';
import { AuctionsGateway } from './auctions.gateway';
import { AuctionsNotificationsService } from './auctions-notifications.service';
import { AuctionJobsProcessor } from './processor/auction-jobs.processor';
import {
  AuctionsController,
  AdminAuctionsController,
} from './auctions.controller';
import { AuthModule } from '../auth/auth.module';
import { InboxModule } from '../inbox/inbox.module';
import { RedisModule } from '../redis/redis.module';
import { QueueModule } from '../queue/queue.module';
import { AUCTION_QUEUE } from '../common/constants/queue.constants';

/**
 * Auctions feature module. Owns:
 *  - Auction lifecycle + bidding (AuctionsService)
 *  - Stripe customer/SetupIntent/off-session helpers (AuctionsPaymentsService)
 *  - Live updates over WebSocket (AuctionsGateway)
 *  - Notification dispatch with Redis-debounced outbid (AuctionsNotificationsService)
 *  - Background job processor for close + closing-soon + autopay-retry
 *
 * Owns its own BullMQ queue (`AUCTION_QUEUE`) so we can co-locate the
 * processor with the auction service that schedules the jobs and avoid
 * cross-module coupling with `QueueModule`.
 *
 * Exports `AuctionsService` so `PrizeService` can populate the embedded
 * `auction` summary in `PrizeConfigurationDto.mapToDto`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Auction,
      AuctionBid,
      PrizeConfiguration,
      PrizeItemWatcher,
      PrizeOrder,
      User,
    ]),
    BullModule.registerQueueAsync({
      name: AUCTION_QUEUE,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => ({
        name: AUCTION_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      }),
    }),
    forwardRef(() => AuthModule),
    InboxModule,
    RedisModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [AuctionsController, AdminAuctionsController],
  providers: [
    AuctionsService,
    AuctionsPaymentsService,
    AuctionsGateway,
    AuctionsNotificationsService,
    AuctionJobsProcessor,
  ],
  exports: [AuctionsService, AuctionsPaymentsService],
})
export class AuctionsModule {}
