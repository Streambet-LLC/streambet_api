import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { AuctionsService } from './auctions.service';
import { AuctionsPaymentsService } from './auctions-payments.service';

/**
 * Stripe webhook. Mounted on the existing `/api/payments/webhook` endpoint
 * (already registered in Stripe with STRIPE_WEBHOOK_SECRET). Only Hermes
 * events are acted on; everything else is acknowledged and ignored. It's
 * an accelerator — Hermes payments are also confirmed by polling.
 */
@ApiExcludeController()
@Controller('payments')
export class AuctionsWebhookController {
  private readonly logger = new Logger(AuctionsWebhookController.name);

  constructor(
    private readonly auctions: AuctionsService,
    private readonly payments: AuctionsPaymentsService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing signature');
    }
    let event: Stripe.Event;
    try {
      event = this.payments.constructWebhookEvent(req.rawBody, signature);
    } catch (err) {
      this.logger.warn(
        `Stripe webhook signature rejected: ${(err as Error).message}`,
      );
      throw new BadRequestException('Invalid signature');
    }
    try {
      await this.auctions.handleStripeEvent(event);
    } catch (err) {
      // 500 so Stripe retries.
      this.logger.error(
        `Stripe webhook ${event.type} failed: ${(err as Error).message}`,
      );
      throw err;
    }
    return { received: true };
  }
}
