import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { StreamLiveProcessor } from './stream-live.processor';
import { StreamModule } from 'src/stream/stream.module';

@Module({
  imports: [
    forwardRef(() => StreamModule),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('redis.host'),
          port: configService.get('redis.port'),
          username: configService.get('redis.username'),
          password: configService.get('redis.password'),
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
        name: 'stream-live',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          name: configService.get('queues.streamLive.name'),
          defaultJobOptions: configService.get(
            'queues.streamLive.defaultJobOptions',
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
