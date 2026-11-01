import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  AUCTION_AUTOPAY_RETRY_JOB,
  AUCTION_CLOSE_JOB,
  AUCTION_CLOSING_SOON_JOB,
  AUCTION_ACTIVATE_JOB,
  AUCTION_QUEUE,
  AUCTION_RECONCILE_JOB,
  AUCTION_SWEEP_JOB,
} from '../../common/constants/queue.constants';
import { AuctionsService } from '../auctions.service';
import { AuctionsNotificationsService } from '../auctions-notifications.service';

export interface AuctionJobData {
  /** Target auction, or 'all' for the periodic sweep. */
  auctionId: string;
}

/**
 * Single processor for every auction job type. All handlers are
 * idempotent, so BullMQ retries are safe.
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
          await this.auctionsService.runAutopayRetry(auctionId);
          return;
        case AUCTION_RECONCILE_JOB:
          await this.auctionsService.reconcileCrypto(auctionId);
          return;
        case AUCTION_SWEEP_JOB:
          await this.auctionsService.runSweep();
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
