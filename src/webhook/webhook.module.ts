import { QueueModule } from 'src/queue/queue.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { forwardRef, Module } from '@nestjs/common';
import { PaymentsModule } from 'src/payments/payments.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Webhook } from './entities/webhook.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook]),
    forwardRef(() => QueueModule),
    forwardRef(() => PaymentsModule),
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
