import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { StreamService } from 'src/stream/stream.service';

export interface StreamLiveJobData {
  streamId: string;
  scheduledTime: Date;
}

@Injectable()
@Processor('stream-live')
export class StreamLiveProcessor extends WorkerHost {
  private readonly logger = new Logger(StreamLiveProcessor.name);

  constructor(private readonly streamService: StreamService) {
    super();
  }

  // This method handles jobs from the "stream-live" queue
  async process(job: Job<StreamLiveJobData>): Promise<void> {
    const { streamId } = job.data;

    this.logger.log(`Processing stream live job for streamId: ${streamId}`);

    try {
      if (!streamId) {
        throw new Error('Stream ID is required');
      }

      await this.streamService.updateStreamStatus(streamId);

      this.logger.log(`Successfully processed stream live job for streamId: ${streamId}`);
    } catch (error) {
      this.logger.error(`Failed to process stream live job for streamId: ${streamId}`, error.stack);
      throw error;
    }
  }
}