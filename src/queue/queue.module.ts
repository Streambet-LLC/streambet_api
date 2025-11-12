import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { StreamModule } from 'src/stream/stream.module';
import {
  COINFLOW_WEBHOOK_QUEUE,
  EMAIL_QUEUE,
  STREAM_LIVE_QUEUE,
} from 'src/common/constants/queue.constants';
import { StreamLiveProcessor } from './processor/stream-live.processor';
import { EmailProcessor } from './processor/email.processor';
import { EmailsModule } from 'src/emails/email.module';
import { CoinflowWebhookProcessor } from './processor/coinflow-webhook.processor';
import { PaymentsModule } from 'src/payments/payments.module';

@Module({
  imports: [
    forwardRef(() => StreamModule),
    forwardRef(() => PaymentsModule),
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
          name: STREAM_LIVE_QUEUE,
          defaultJobOptions: configService.get(
            'queue.queues.streamLive.defaultJobOptions',
          ),
        }),
      },
      {
        name: EMAIL_QUEUE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          name: EMAIL_QUEUE,
          defaultJobOptions: configService.get(
            'queue.queues.email.defaultJobOptions',
          ),
        }),
      },
      {
        name: COINFLOW_WEBHOOK_QUEUE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          name: COINFLOW_WEBHOOK_QUEUE,
          defaultJobOptions: configService.get(
            'queue.queues.coinflowWebhookQueue.defaultJobOptions',
          ),
        }),
      },
    ),
    EmailsModule,
  ],
  providers: [StreamLiveProcessor, QueueService, EmailProcessor, CoinflowWebhookProcessor],
  exports: [QueueService],
})
export class QueueModule {}
