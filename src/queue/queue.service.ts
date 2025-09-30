import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  EMAIL_QUEUE,
  MAKE_LIVE_JOB,
  SEND_EMAIL_JOB,
  STREAM_LIVE_QUEUE,
} from 'src/common/constants/queue.constants';
import { EmailPayloadDto } from 'src/emails/dto/email.dto';
import { EmailType } from 'src/enums/email-type.enum';

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
