import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentsService } from 'src/payments/payments.service';

/**
 * Safety-net cron for ACH (us_bank_account) prize orders.
 *
 * ACH orders sit in `payment_processing` for 3-5 business days and only flip
 * to `paid` when Stripe's `payment_intent.succeeded` /
 * `checkout.session.async_payment_succeeded` webhook is received AND processed.
 * If that webhook is ever missed (event not subscribed on the endpoint, a
 * deploy gap, a transient 5xx Stripe eventually stops retrying, etc.) the
 * order would be stranded in `payment_processing` forever even though the
 * funds have already settled at Stripe.
 *
 * This periodically re-checks every stuck order against Stripe's source of
 * truth and re-drives the same idempotent finalize paths the webhook uses.
 */
@Injectable()
export class AchSettlementReconcilerService {
  private readonly logger = new Logger(AchSettlementReconcilerService.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcile(): Promise<void> {
    this.logger.debug('Running ACH settlement reconciliation sweep');
    try {
      const result = await this.paymentsService.reconcileProcessingAchOrders({
        // Give in-progress checkouts a few minutes before we poll Stripe so
        // we never race the live webhook on a brand-new order.
        olderThanMinutes: 10,
      });
      if (result.scanned > 0) {
        this.logger.log(
          `ACH reconciliation sweep: scanned=${result.scanned} settled=${result.settled} failed=${result.failed} stillProcessing=${result.stillProcessing} skippedNoPaymentIntent=${result.skippedNoPaymentIntent} errors=${result.errors}`,
        );
      }
    } catch (err) {
      this.logger.error('ACH settlement reconciliation sweep failed', err);
    }
  }
}
