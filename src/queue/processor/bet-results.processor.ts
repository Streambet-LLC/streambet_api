import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  BET_RESULTS_QUEUE,
  TRACK_BET_RESULT_JOB,
  SEND_STREAM_SUMMARY_JOB,
} from 'src/common/constants/queue.constants';
import { QueueService } from '../queue.service';
import { UsersService } from 'src/users/users.service';
import { EmailType } from 'src/enums/email-type.enum';
import { ConfigService } from '@nestjs/config';
import {
  BetResultJobData,
  StreamSummaryJobData,
  UserBetSummary,
} from '../dto/bet-result-job.dto';
import { CurrencyType } from 'src/enums/currency.enum';

@Injectable()
@Processor(BET_RESULTS_QUEUE)
export class BetResultsProcessor extends WorkerHost {
  private readonly logger = new Logger(BetResultsProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === TRACK_BET_RESULT_JOB) {
      // Individual bet results are just stored (BullMQ handles persistence)
      this.logger.log(
        `Stored bet result for user ${job.data.userId} in stream ${job.data.streamId}`,
      );
      return;
    }

    if (job.name === SEND_STREAM_SUMMARY_JOB) {
      await this.processSummary(job);
      return;
    }
  }

  private async processSummary(
    job: Job<StreamSummaryJobData>,
  ): Promise<void> {
    const { streamId, streamName } = job.data;
    this.logger.log(`Processing betting summary for stream: ${streamId}`);

    try {
      // 1. Get all bet result jobs for this stream
      const queue = await this.queueService.getBetResultsQueue();
      const allJobs = await queue.getJobs(['completed', 'waiting']);
      const streamBetJobs = allJobs.filter(
        (j) =>
          j.name === TRACK_BET_RESULT_JOB && j.data.streamId === streamId,
      );

      this.logger.log(
        `Found ${streamBetJobs.length} bet results for stream ${streamId}`,
      );

      if (streamBetJobs.length === 0) {
        this.logger.log(
          `No bet results found for stream ${streamId}, skipping email send`,
        );
        return;
      }

      // 2. Aggregate by user
      const userSummaries = this.aggregateByUser(streamBetJobs, streamName);

      // 3. Queue email for each user
      for (const summary of userSummaries.values()) {
        await this.queueUserSummaryEmail(summary);
      }

      // 4. Clean up bet result jobs for this stream
      await Promise.all(streamBetJobs.map((j) => j.remove()));

      this.logger.log(
        `Successfully processed ${userSummaries.size} user summaries for stream ${streamId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process summary for stream ${streamId}`,
        error.stack,
      );
      throw error;
    }
  }

  private aggregateByUser(
    jobs: Job<BetResultJobData>[],
    streamName: string,
  ): Map<string, UserBetSummary> {
    const summaries = new Map<string, UserBetSummary>();

    for (const job of jobs) {
      const data = job.data as BetResultJobData;

      if (!summaries.has(data.userId)) {
        summaries.set(data.userId, {
          userId: data.userId,
          streamId: data.streamId,
          streamName: streamName,
          rounds: [],
        });
      }

      const summary = summaries.get(data.userId);
      summary.rounds.push({
        roundName: data.roundName,
        won: data.won,
        amount: data.amount,
        currency: data.currency,
      });
    }

    return summaries;
  }

  private async queueUserSummaryEmail(
    summary: UserBetSummary,
  ): Promise<void> {
    try {
      const user = await this.usersService.findUserByUserId(summary.userId);
      if (!user?.email || user.email.includes('@example.com')) {
        this.logger.log(
          `Skipping email for user ${summary.userId} - no valid email`,
        );
        return;
      }

      // Check notification preferences (like existing emails)
      const notificationPreferences = user.notificationPreferences;
      if (!notificationPreferences?.emailNotification) {
        this.logger.log(
          `Skipping email for user ${summary.userId} - email notifications disabled`,
        );
        return;
      }

      const dashboardLink =
        this.configService.get<string>('email.HOST_URL') || '';

      const emailData = {
        toAddress: [user.email],
        subject: `Your Picks Summary for ${summary.streamName}`,
        params: {
          fullName: user.username,
          streamName: summary.streamName,
          rounds: summary.rounds.map((r) => ({
            roundName: r.roundName,
            won: r.won,
            amount: r.amount,
            currency:
              r.currency === CurrencyType.GOLD_COINS ? 'gold' : 'sweep',
          })),
          dashboardLink: `${dashboardLink}/betting-history`,
        },
      };

      await this.queueService.addEmailJob(emailData, EmailType.BettingSummary);
      this.logger.log(`Queued summary email for user ${summary.userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue email for user ${summary.userId}`,
        error.stack,
      );
      // Don't throw - continue processing other users
    }
  }
}
