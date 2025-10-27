import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  BET_RESULTS_QUEUE,
  TRACK_BET_RESULT_JOB,
  SEND_STREAM_SUMMARY_JOB,
  STREAM_BET_JOBS_KEY,
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
import { RedisService } from 'src/redis/redis.service';

@Injectable()
@Processor(BET_RESULTS_QUEUE)
export class BetResultsProcessor extends WorkerHost {
  private readonly logger = new Logger(BetResultsProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
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

    // Warn about unrecognized job types to catch misconfigurations
    this.logger.warn(
      `Unrecognized job type '${job.name}' (ID: ${job.id}) in ${BET_RESULTS_QUEUE}. Data: ${JSON.stringify(job.data)}`,
    );
  }

  private async processSummary(
    job: Job<StreamSummaryJobData>,
  ): Promise<void> {
    const { streamId, streamName } = job.data;
    this.logger.log(`Processing betting summary for stream: ${streamId}`);

    try {
      // Get job IDs from Redis Set
      const redis = this.redisService.getClient();
      const streamJobsKey = STREAM_BET_JOBS_KEY(streamId);
      const jobIds = await redis.smembers(streamJobsKey);

      this.logger.log(
        `Found ${jobIds.length} tracked bet job IDs for stream ${streamId}`,
      );

      if (jobIds.length === 0) {
        this.logger.log(
          `No bet results found for stream ${streamId}, skipping email send`,
        );
        return;
      }

      // Retrieve jobs from queue using tracked IDs
      const queue = await this.queueService.getBetResultsQueue();
      const jobPromises = jobIds.map((id) => queue.getJob(id));
      const jobs = await Promise.all(jobPromises);

      // Filter out null jobs (already removed) and ensure correct type
      const streamBetJobs = jobs.filter(
        (retrievedBetJob): retrievedBetJob is Job<BetResultJobData> =>
          retrievedBetJob !== null &&
          retrievedBetJob !== undefined &&
          retrievedBetJob.name === TRACK_BET_RESULT_JOB &&
          retrievedBetJob.data.streamId === streamId,
      );

      this.logger.log(
        `Retrieved ${streamBetJobs.length} valid bet result jobs for stream ${streamId}`,
      );

      if (streamBetJobs.length === 0) {
        this.logger.warn(
          `All tracked jobs for stream ${streamId} were already removed or invalid`,
        );
        // Clean up the Redis set since jobs are gone
        await redis.del(streamJobsKey);
        return;
      }

      // Aggregate by user
      const userSummaries = this.aggregateByUser(streamBetJobs, streamName);

      // Queue email for each user
      for (const summary of userSummaries.values()) {
        await this.queueUserSummaryEmail(summary);
      }

      // Clean up bet result jobs for this stream
      await Promise.all(streamBetJobs.map((retrievedBetJob) => retrievedBetJob.remove()));

      // Clean up the Redis set
      await redis.del(streamJobsKey);

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

      const dashboardHost = this.configService.get<string>('email.HOST_URL');

      // Validate dashboard host config immediately to avoid sending emails with broken links
      if (!dashboardHost || typeof dashboardHost !== 'string' || dashboardHost.trim() === '') {
        this.logger.error(
          `Missing or invalid config 'email.HOST_URL' while queuing summary email for user ${summary.userId} and stream ${summary.streamId}. Aborting email send. Please set the 'email.HOST_URL' configuration.`,
        );
        return; // Skip sending email to avoid broken dashboard links
      }

      // Normalize host (remove trailing slash) and build the dashboard link
      const normalizedHost = dashboardHost.replace(/\/$/, '');
      const dashboardLink = `${normalizedHost}/betting-history`;

      const emailData = {
        toAddress: [user.email],
        subject: `Your Picks Summary for ${summary.streamName}`,
        params: {
          fullName: user.username,
          streamName: summary.streamName,
          rounds: summary.rounds.map((r) => ({
            roundName: r.roundName,
            status: r.won ? 'won' : 'lost',
            amount: r.amount,
            currencyType: this.getCurrencyLabel(r.currency),
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

  private getCurrencyLabel(currency: CurrencyType): string {
    switch (currency) {
      case CurrencyType.GOLD_COINS:
        return 'Gold Coins';
      case CurrencyType.SWEEP_COINS:
        return 'Sweep Coins';
      case CurrencyType.STREAM_COINS:
        return 'Stream Coins';
      case CurrencyType.FREE_TOKENS:
        return 'Free Tokens';
      default:
        this.logger.warn(`Unknown currency type: ${currency}`);
        return 'Unknown';
    }
  }
}
