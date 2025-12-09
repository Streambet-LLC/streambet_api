import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { QueueService } from 'src/queue/queue.service';
import { CoinflowWebhookDto } from './dto/coinflow-webhook.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Webhook } from './entities/webhook.entity';
import { Repository } from 'typeorm';
import { N8nIntegrationService } from 'src/integrations/n8n/n8n-integration.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(forwardRef(() => QueueService)) private readonly queueService: QueueService,
    @InjectRepository(Webhook) private webhookRepository: Repository<Webhook>,
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
    this.n8nIntegrationService.handleCoinflowWebhook({
      payload,
      webhookId: webhook.id,
    }).catch(error => {
      // Log but don't fail the webhook processing
      this.logger.error('n8n integration error', error?.stack);
    });

    return { received: true };
  };

  async storeWebhook(provider: string, data: string) {
    if (!provider || !data) {
      return;
    }

    return await this.webhookRepository.save({ provider, data });
  };
}
