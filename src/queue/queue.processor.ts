// src/queue/queue.processor.ts
import { Worker } from 'bullmq';
import redisConfig from '../config/redis.config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StreamService } from '../stream/stream.service';

let streamService: StreamService;

async function getStreamService() {
  if (!streamService) {
    const app = await NestFactory.createApplicationContext(AppModule);
    streamService = app.get(StreamService);
  }
  return streamService;
}

export const streamLiveWorker = new Worker(
  'stream-live',
  async job => {
    const { streamId } = job.data;
    console.log(`Queue execution started for streamId: ${streamId}`, 'StreamLiveWorker');
    try {
      const service = await getStreamService();
      await service.updateStreamStatus(streamId);
      console.log(`Queue execution completed for streamId: ${streamId}`, 'StreamLiveWorker');
    } catch (error) {
      console.error(`Queue execution failed for streamId: ${streamId} - ${error.message}`, 'StreamLiveWorker');
      throw error;
    }
  },
  { connection: redisConfig }
);
