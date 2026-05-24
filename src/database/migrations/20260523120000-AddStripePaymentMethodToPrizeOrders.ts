import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist the buyer's chosen Stripe payment method on `prize_orders`.
 *
 * Why: we split the buyer service fee into two tiers — `card` (3%) and
 * `us_bank_account` (0.8%) — so the buyer's selection has to be
 * captured at order/offer creation time and re-read whenever we
 * actually open the Stripe Checkout session (which can happen later
 * for offer / counter-offer flows). Storing the chosen method on the
 * order row is the secure way to do that: the value comes from the
 * authenticated request when the order is first written, then the
 * server is the only source of truth at acceptance time.
 *
 * Null is allowed because:
 *   - coin-only and crypto orders never touch Stripe.
 *   - rows created before this migration have no recorded method.
 *     Service code treats `null` as "fall back to the card rate" so
 *     the higher fee is applied conservatively rather than
 *     under-billing.
 */
export class AddStripePaymentMethodToPrizeOrders20260523120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prize_orders" ADD COLUMN IF NOT EXISTS "stripe_payment_method" varchar(32) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prize_orders" DROP COLUMN IF EXISTS "stripe_payment_method"`,
    );
  }
}
