import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  AUCTION_AUTOPAY_RETRY_JOB,
  AUCTION_CLOSE_JOB,
  AUCTION_CLOSING_SOON_JOB,
  AUCTION_ACTIVATE_JOB,
  AUCTION_QUEUE,
} from '../../common/constants/queue.constants';
import { AuctionsService } from '../auctions.service';
import { AuctionsNotificationsService } from '../auctions-notifications.service';

export interface AuctionJobData {
  auctionId: string;
  /** For autopay-retry: the runner-up bidder we want to attempt next. */
  retryUserId?: string;
}

/**
 * Single processor for all 3 auction job types. Job name routing is
 * cleaner than 3 separate processors for related lifecycle events.
 */
@Injectable()
@Processor(AUCTION_QUEUE)
export class AuctionJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(AuctionJobsProcessor.name);

  constructor(
    @Inject(forwardRef(() => AuctionsService))
    private readonly auctionsService: AuctionsService,
    private readonly notifications: AuctionsNotificationsService,
  ) {
    super();
  }

  async process(job: Job<AuctionJobData>): Promise<void> {
    const { name, data } = job;
    const auctionId = data?.auctionId;
    if (!auctionId) {
      this.logger.warn(`Auction job ${name}#${job.id} missing auctionId`);
      return;
    }

    this.logger.log(`Processing ${name} for auction ${auctionId}`);

    try {
      switch (name) {
        case AUCTION_CLOSING_SOON_JOB:
          await this.notifications.notifyClosingSoon(auctionId);
          return;
        case AUCTION_CLOSE_JOB:
          await this.auctionsService.runCloseJob(auctionId);
          return;
        case AUCTION_ACTIVATE_JOB:
          await this.auctionsService.runActivateJob(auctionId);
          return;
        case AUCTION_AUTOPAY_RETRY_JOB:
          await this.auctionsService.runAutopayRetry(
            auctionId,
            data.retryUserId,
          );
          return;
        default:
          this.logger.warn(`Unknown auction job name: ${name}`);
      }
    } catch (err) {
      this.logger.error(
        `Auction job ${name} for ${auctionId} failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}
