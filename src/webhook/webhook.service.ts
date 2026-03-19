import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { QueueService } from 'src/queue/queue.service';
import { CoinflowWebhookDto } from './dto/coinflow-webhook.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Webhook } from './entities/webhook.entity';
import { Repository } from 'typeorm';
import { N8nIntegrationService } from 'src/integrations/n8n/n8n-integration.service';
import { stripe } from 'src/integrations/stripe';
import Stripe from 'stripe';
import { User } from 'src/users/entities/user.entity';
import { PaymentsService } from 'src/payments/payments.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
    @InjectRepository(Webhook) private webhookRepository: Repository<Webhook>,
    @InjectRepository(User) private userRepository: Repository<User>,
    private readonly n8nIntegrationService: N8nIntegrationService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  async queueCoinflowWebhookEvent(payload: CoinflowWebhookDto) {
    const webhookData = JSON.stringify(payload);

    const webhook = await this.storeWebhook('coinflow', webhookData);

    await this.queueService.addCoinflowWebhookJob({
      webhookId: webhook.id,
      data: webhook.data,
    });

    // Send to n8n integration (non-blocking)
    this.n8nIntegrationService
      .handleCoinflowWebhook({
        payload,
        webhookId: webhook.id,
      })
      .catch((error) => {
        // Log but don't fail the webhook processing
        this.logger.error('n8n integration error', error?.stack);
      });

    return { received: true };
  }

  /**
   * @deprecated Stripe webhooks are now consolidated in PaymentsService.
   * This method delegates to paymentsService.handleWebhookEvent() for backward compatibility.
   * Point your Stripe Dashboard webhook to POST /api/payments/webhook instead.
   */
  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    this.logger.warn(
      'Stripe webhook received on deprecated /api/webhook/stripe endpoint. ' +
        'Please update Stripe Dashboard to use /api/payments/webhook instead.',
    );
    return this.paymentsService.handleWebhookEvent(signature, rawBody);
  }

  async storeWebhook(provider: string, data: string) {
    if (!provider || !data) {
      return;
    }

    return await this.webhookRepository.save({ provider, data });
  }
}
