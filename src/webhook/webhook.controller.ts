import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
  Headers,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CoinflowWebhookGuard } from '../auth/guards/coinflow-webhook.guard';
import { CoinflowWebhookDto } from './dto/coinflow-webhook.dto';
import { WebhookService } from './webhook.service';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';

@ApiTags('webhook')
@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  /** Webhook receiver for coinflow. */
  @Post('coinflow')
  @UseGuards(CoinflowWebhookGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async queueCoinflowWebhook(@Body() payload: CoinflowWebhookDto) {
    Logger.log(`Coinflow webhook received`, WebhookController.name);
    return this.webhookService.queueCoinflowWebhookEvent(payload);
  }

  /** Webhook receiver for Stripe Connect account events. */
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    Logger.log(`Stripe webhook received`, WebhookController.name);
    return this.webhookService.handleStripeWebhook(req.rawBody, signature);
  }
}
