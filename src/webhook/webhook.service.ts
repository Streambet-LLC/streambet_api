import {
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common';
import { QueueService } from 'src/queue/queue.service';
import { CoinflowWebhookDto } from './dto/coinflow-webhook.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Webhook } from './entities/webhook.entity';
import { Repository } from 'typeorm';

@Injectable()
export class WebhookService {
  constructor(
    @Inject(forwardRef(() => QueueService)) private readonly queueService: QueueService,
    @InjectRepository(Webhook) private webhookRepository: Repository<Webhook>,
  ) {}

  async queueCoinflowWebhookEvent(payload: CoinflowWebhookDto) {
    const webhookData = JSON.stringify(payload);

    const webhook = await this.storeWebhook('coinflow', webhookData);

    await this.queueService.addCoinflowWebhookJob({
      webhookId: webhook.id,
      data: webhook.data,
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
