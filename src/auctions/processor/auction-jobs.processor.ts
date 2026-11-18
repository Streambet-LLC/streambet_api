import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, Job } from 'bullmq';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  AUCTION_AUTOPAY_RETRY_JOB,
  AUCTION_PAYMENT_REMINDER_JOB,
  AUCTION_CLOSE_JOB,
  AUCTION_CLOSING_DAY_JOB,
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

  async process(job: Job<AuctionJobData>, token?: string): Promise<void> {
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
        case AUCTION_CLOSING_DAY_JOB:
          await this.notifications.notifyWatchersClosingDay(auctionId);
          return;
        case AUCTION_CLOSE_JOB: {
          const later = await this.auctionsService.runCloseJob(auctionId);
          if (later && token) {
            // The end moved later: run this same job again at the new end.
            await job.moveToDelayed(later.getTime(), token);
            throw new DelayedError();
          }
          return;
        }
        case AUCTION_ACTIVATE_JOB:
          await this.auctionsService.runActivateJob(auctionId);
          return;
        case AUCTION_AUTOPAY_RETRY_JOB:
          await this.auctionsService.runAutopayRetry(auctionId);
          return;
        case AUCTION_PAYMENT_REMINDER_JOB:
          await this.notifications.notifyPaymentReminder(auctionId);
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
      if (err instanceof DelayedError) throw err; // rescheduled, not a failure
      this.logger.error(
        `Auction job ${name} for ${auctionId} failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}
