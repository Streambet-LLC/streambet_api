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

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
    @InjectRepository(Webhook) private webhookRepository: Repository<Webhook>,
    @InjectRepository(User) private userRepository: Repository<User>,
    private readonly n8nIntegrationService: N8nIntegrationService,
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

  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;
    try {
      event = stripe.constructWebhookEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.error('Stripe webhook signature verification failed', err);
      throw new BadRequestException('Invalid webhook signature');
    }

    await this.storeWebhook('stripe', JSON.stringify(event));

    if (event.type === 'account.updated') {
      await this.handleAccountUpdated(event.data.object as Stripe.Account);
    }

    return { received: true };
  }

  private async handleAccountUpdated(account: Stripe.Account) {
    if (!account.details_submitted) return;

    const user = await this.userRepository.findOne({
      where: { stripeAccountId: account.id },
    });

    if (!user) {
      this.logger.warn(`No user found for Stripe account ${account.id}`);
      return;
    }

    if (!user.sellerOnboardingCompleted) {
      await this.userRepository.update(user.id, { sellerOnboardingCompleted: true });
      this.logger.log(`Seller onboarding completed for user ${user.id}`);
    }
  }

  async storeWebhook(provider: string, data: string) {
    if (!provider || !data) {
      return;
    }

    return await this.webhookRepository.save({ provider, data });
  }
}
