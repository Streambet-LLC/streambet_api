import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { StreamLiveProcessor } from './stream-live.processor';
import { StreamModule } from 'src/stream/stream.module';
import { STREAM_LIVE_QUEUE } from 'src/common/constants/queue.constants';

@Module({
  imports: [
    forwardRef(() => StreamModule),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('queue.redis.host'),
          port: configService.get('queue.redis.port'),
          username: configService.get('queue.redis.username'),
          password: configService.get('queue.redis.password'),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      }),
    }),
    BullModule.registerQueueAsync(
      {
        name: STREAM_LIVE_QUEUE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          name: configService.get('queue.queues.streamLive.name'),
          defaultJobOptions: configService.get(
            'queue.queues.streamLive.defaultJobOptions',
          ),
        }),
      },
      //   {
      //     name: 'email',
      //     imports: [ConfigModule],
      //     inject: [ConfigService],
      //     useFactory: (configService: ConfigService) => ({
      //       name: configService.get('queues.emailQueue.name'),
      //       defaultJobOptions: configService.get('queues.emailQueue.defaultJobOptions'),
      //     }),
      //   },
    ),
  ],
  providers: [StreamLiveProcessor, QueueService],
  exports: [QueueService],
})
export class QueueModule {}
