import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

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
    @InjectQueue('stream-live') private streamLiveQueue: Queue,
    // @InjectQueue('email') private emailQueue: Queue,
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
        'make-live',
        { streamId, scheduledTime },
        {
          delay: Math.max(delay, 0),
          jobId: streamId,
          ...options,
        },
      );

      this.logger.log(`Added stream live job for streamId: ${streamId}, scheduled for: ${scheduledTime}`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add stream live job for streamId: ${streamId}`, error.stack);
      throw error;
    }
  }

//   async addEmailJob(
//     emailData: any,
//     options?: QueueJobOptions,
//   ) {
//     try {
//       const job = await this.emailQueue.add(
//         'send-email',
//         emailData,
//         options,
//       );

//       this.logger.log(`Added email job: ${job.id}`);
//       return job;
//     } catch (error) {
//       this.logger.error(`Failed to add email job`, error.stack);
//       throw error;
//     }
//   }

  async getJobStatus(queueName: string, jobId: string) {
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
  }

  private getQueueByName(queueName: string): Queue {
    switch (queueName) {
      case 'stream-live':
        return this.streamLiveQueue;
    //   case 'email':
    //     return this.emailQueue;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }
  }

  getJobById(queueName: string, jobId: string) {
    const queue = this.getQueueByName(queueName);
    return queue.getJob(jobId);
  }
}