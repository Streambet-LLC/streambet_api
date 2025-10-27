import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  COINFLOW_WEBHOOK_QUEUE,
  EMAIL_QUEUE,
  MAKE_LIVE_JOB,
  QUEUE_COINFLOW_WEBHOOK,
  SEND_EMAIL_JOB,
  STREAM_LIVE_QUEUE,
  BET_RESULTS_QUEUE,
  TRACK_BET_RESULT_JOB,
  SEND_STREAM_SUMMARY_JOB,
} from 'src/common/constants/queue.constants';
import { EmailPayloadDto } from 'src/emails/dto/email.dto';
import { EmailType } from 'src/enums/email-type.enum';
import { WebhookDto } from 'src/webhook/dto/webhook.dto';
import {
  BetResultJobData,
  StreamSummaryJobData,
} from './dto/bet-result-job.dto';

export interface QueueJobOptions {
  delay?: number;
  attempts?: number;
  priority?: number;
  removeOnComplete?: number;
  removeOnFail?: number;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(STREAM_LIVE_QUEUE) private streamLiveQueue: Queue,
    @InjectQueue(EMAIL_QUEUE) private mailQueue: Queue,
    @InjectQueue(COINFLOW_WEBHOOK_QUEUE) private coinflowWebhookQueue: Queue,
    @InjectQueue(BET_RESULTS_QUEUE) private betResultsQueue: Queue,
  ) {}

  async addStreamLiveJob(
    streamId: string,
    scheduledTime: Date,
    options?: QueueJobOptions,
  ) {
    try {
      const delay = scheduledTime.getTime() - Date.now();
      if (delay < 0) {
        throw new Error('Scheduled time must be in the future');
      }

      const job = await this.streamLiveQueue.add(
        MAKE_LIVE_JOB,
        { streamId, scheduledTime },
        {
          delay: Math.max(delay, 0),
          jobId: streamId,
          ...options,
        },
      );

      this.logger.log(
        `Added stream live job for streamId: ${streamId}, scheduled for: ${scheduledTime}`,
      );
      return job;
    } catch (error) {
      this.logger.error(
        `Failed to add stream live job for streamId: ${streamId}`,
        error.stack,
      );
      throw error;
    }
  }

  async addEmailJob(data: EmailPayloadDto, type: EmailType) {
    try {
      const job = await this.mailQueue.add(SEND_EMAIL_JOB, { data, type });

      this.logger.log(`Added email job: ${job.id}`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add email job`, error.stack);
      throw error;
    }
  }

  async addCoinflowWebhookJob(webhook: WebhookDto) {
    try {
      const webhookData = JSON.stringify(webhook);
      const job = await this.coinflowWebhookQueue.add(QUEUE_COINFLOW_WEBHOOK, webhookData);

      this.logger.log(`Added coinflow webhook job: ${job.id}`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add coinflow webhook job`, error.stack);
      throw error;
    }
  }

  async addBetResultJob(data: BetResultJobData) {
    try {
      const job = await this.betResultsQueue.add(TRACK_BET_RESULT_JOB, data, {
        removeOnComplete: false, // Keep until stream ends
      });
      this.logger.log(
        `Added bet result job: ${job.id} for stream ${data.streamId}`,
      );
      return job;
    } catch (error) {
      this.logger.error(`Failed to add bet result job`, error.stack);
      throw error;
    }
  }

  async addStreamSummaryJob(data: StreamSummaryJobData) {
    try {
      const job = await this.betResultsQueue.add(SEND_STREAM_SUMMARY_JOB, data);
      this.logger.log(`Added stream summary job for stream ${data.streamId}`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add stream summary job`, error.stack);
      throw error;
    }
  }

  async getBetResultsQueue(): Promise<Queue> {
    return this.betResultsQueue;
  }

  async getJobStatus(queueName: string, jobId: string) {
    try {
      const queue = this.getQueueByName(queueName);
      const job = await queue.getJob(jobId);

      if (!job) {
        return null;
      }

      return {
        id: job.id,
        name: job.name,
        data: job.data,
        state: await job.getState(),
        progress: job.progress,
        failedReason: job.failedReason,
        timestamp: job.timestamp,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get job status for ${jobId} in queue ${queueName}`,
        error.stack,
      );
      throw error;
    }
  }

  private getQueueByName(queueName: string): Queue {
    switch (queueName) {
      case STREAM_LIVE_QUEUE:
        return this.streamLiveQueue;
      case EMAIL_QUEUE:
        return this.mailQueue;
      case COINFLOW_WEBHOOK_QUEUE:
        return this.coinflowWebhookQueue;
      case BET_RESULTS_QUEUE:
        return this.betResultsQueue;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }
  }

  getJobById(queueName: string, jobId: string) {
    try {
      const queue = this.getQueueByName(queueName);
      return queue.getJob(jobId);
    } catch (error) {
      this.logger.error(
        `Failed to get job ${jobId} from queue ${queueName}`,
        error.stack,
      );
      throw error;
    }
  }
}
