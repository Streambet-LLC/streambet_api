import { QueueModule } from 'src/queue/queue.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { forwardRef, Module } from '@nestjs/common';
import { PaymentsModule } from 'src/payments/payments.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Webhook } from './entities/webhook.entity';
import { N8nIntegrationModule } from 'src/integrations/n8n/n8n-integration.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook]),
    forwardRef(() => QueueModule),
    forwardRef(() => PaymentsModule),
    N8nIntegrationModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
