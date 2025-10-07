import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { COINFLOW_WEBHOOK_QUEUE } from 'src/common/constants/queue.constants';
import { PaymentsService } from 'src/payments/payments.service';
import { WebhookDto } from 'src/webhook/dto/webhook.dto';

@Injectable()
@Processor(COINFLOW_WEBHOOK_QUEUE)
export class CoinflowWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(CoinflowWebhookProcessor.name);

  constructor(private readonly paymentService: PaymentsService) {
    super();
  }

  // This method handles jobs from the "coinflow webhook" queue
  async process(job: Job<string>): Promise<void> {
    const jobString = job.data;

    try {
      const webhook: WebhookDto = JSON.parse(jobString);
      await this.paymentService.handleCoinflowWebhookEvent(webhook);

    } catch (error) {
      this.logger.error(
        `Failed to process coinflow webhook data: ${jobString}`,
        error.stack,
      );
      throw error;
    }
  }
}
