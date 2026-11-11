import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Auction } from '../prize/entities/auction.entity';
import { AuctionBid } from '../prize/entities/auction-bid.entity';
import { AuctionCryptoDeposit } from '../prize/entities/auction-crypto-deposit.entity';
import { User } from '../users/entities/user.entity';
import { AuctionsService } from './auctions.service';
import { AuctionsPaymentsService } from './auctions-payments.service';
import { AuctionsCryptoService } from './auctions-crypto.service';
import { AuctionsMediaService } from './auctions-media.service';
import { AuctionsEstimateService } from './auctions-estimate.service';
import { AuctionsSpinService } from './auctions-spin.service';
import { AuctionsGateway } from './auctions.gateway';
import { AuctionsNotificationsService } from './auctions-notifications.service';
import { AuctionJobsProcessor } from './processor/auction-jobs.processor';
import { AuctionsController } from './auctions.controller';
import { AdminAuctionsController } from './admin-auctions.controller';
import { AuctionsWebhookController } from './auctions-webhook.controller';
import { AuctionsOgController } from './auctions-og.controller';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { AdminModule } from '../admin/admin.module';
import { AUCTION_QUEUE } from '../common/constants/queue.constants';

/**
 * Hermes Auctions — admin-hosted, zero-seller-fee collectibles auctions
 * (the buyer pays a premium on the hammer; see hermes.pricing.ts).
 *
 *  - AuctionsService: lifecycle, proxy bidding, settlement
 *  - AuctionsPaymentsService: Stripe saved card / ACH + off-session charge
 *  - AuctionsCryptoService: hermes-auctions USDC escrow program
 *  - AuctionsEstimateService: "pull it for me" Est. Value
 *  - AuctionsMediaService: admin photo / video uploads
 *  - AuctionsSpinService: Pika-generated 360° spin videos (front + back)
 *  - AuctionsGateway: live updates; AuctionJobsProcessor: BullMQ jobs
 *
 * Exports `AuctionsService` for the legacy PrizeService / PaymentsService
 * call sites.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Auction, AuctionBid, AuctionCryptoDeposit, User]),
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
    forwardRef(() => QueueModule),
    AdminModule,
  ],
  controllers: [
    AuctionsController,
    AdminAuctionsController,
    AuctionsWebhookController,
    AuctionsOgController,
  ],
  providers: [
    AuctionsService,
    AuctionsPaymentsService,
    AuctionsCryptoService,
    AuctionsMediaService,
    AuctionsEstimateService,
    AuctionsSpinService,
    AuctionsGateway,
    AuctionsNotificationsService,
    AuctionJobsProcessor,
  ],
  exports: [AuctionsService, AuctionsPaymentsService],
})
export class AuctionsModule {}
