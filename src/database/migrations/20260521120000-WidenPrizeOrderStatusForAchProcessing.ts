import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen `prize_orders.status` from `varchar(20)` to `varchar(25)` so it
 * can hold the new ACH-payment statuses introduced alongside Stripe
 * ACH (us_bank_account) checkout support:
 *
 *   - `payment_processing` (19 chars) — buyer authorised an ACH debit
 *     via Stripe Checkout but the funds have not yet settled. The
 *     order has reserved inventory but the seller must NOT ship until
 *     Stripe confirms `payment_intent.succeeded`.
 *   - `payment_failed` (14 chars) — ACH debit bounced. Order is
 *     reverted (stock restored, redemption cancelled) and both buyer
 *     and seller are notified.
 *
 * The previous max width of 20 chars was enough for everything we used
 * before (`offer_accepted` is the longest at 14 chars), but
 * `payment_processing` would be silently truncated to `payment_processi`
 * if we tried to write it. This migration widens the column with no
 * data changes.
 */
export class WidenPrizeOrderStatusForAchProcessing20260521120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prize_orders" ALTER COLUMN "status" TYPE varchar(25)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert any rows that hold the new statuses to `cancelled` so the
    // narrower column can hold them, then shrink. Anything stuck in
    // `payment_processing` is treated as cancelled on rollback —
    // operators should reconcile manually if that ever runs in prod.
    await queryRunner.query(
      `UPDATE "prize_orders" SET "status" = 'cancelled' WHERE "status" IN ('payment_processing', 'payment_failed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_orders" ALTER COLUMN "status" TYPE varchar(20)`,
    );
  }
}
