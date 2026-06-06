import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add explicit order-type + grouping to `prize_orders` so the admin Orders
 * view can tell single purchases, multi-item cart purchases, bundle offers,
 * and single make-an-offer apart (today everything is flattened into `status`).
 *
 * - `order_type`: 'single' | 'cart' | 'bundle_offer' | 'offer' (default 'single').
 * - `order_group_id`: shared id for orders created together (cart checkout
 *   group = the Stripe session id, which can be ~100 chars; bundle-offer group
 *   = the bundle id). Null for standalone single orders.
 *
 * Backfill derives the values from existing data:
 *   - bundle_offer: `offer_notes` carries a `[Bundle: <id>]` marker.
 *   - offer: an offer-state order without a bundle marker.
 *   - cart: a purchase whose `stripe_session_id` is shared by >1 order.
 *   - single: everything else (the column default).
 */
export class AddOrderTypeAndGroupToPrizeOrders20260605120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prize_orders" ADD COLUMN IF NOT EXISTS "order_type" varchar(20) NOT NULL DEFAULT 'single'`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_orders" ADD COLUMN IF NOT EXISTS "order_group_id" varchar(255) NULL`,
    );

    // Bundle offers — most specific, do first. Pull the id out of the marker.
    await queryRunner.query(`
      UPDATE "prize_orders"
      SET "order_type" = 'bundle_offer',
          "order_group_id" = substring("offer_notes" from '\\[Bundle: ([^\\]]+)\\]')
      WHERE "offer_notes" LIKE '[Bundle:%'
    `);

    // Single make-an-offer orders (offer states, not part of a bundle).
    await queryRunner.query(`
      UPDATE "prize_orders"
      SET "order_type" = 'offer'
      WHERE "status" IN ('offer_made', 'countered', 'offer_accepted', 'rejected')
        AND "order_type" = 'single'
    `);

    // Multi-item cart purchases — orders sharing a Stripe checkout session.
    await queryRunner.query(`
      UPDATE "prize_orders" o
      SET "order_type" = 'cart',
          "order_group_id" = o."stripe_session_id"
      WHERE o."stripe_session_id" IS NOT NULL
        AND o."order_type" = 'single'
        AND o."stripe_session_id" IN (
          SELECT "stripe_session_id"
          FROM "prize_orders"
          WHERE "stripe_session_id" IS NOT NULL
          GROUP BY "stripe_session_id"
          HAVING COUNT(*) > 1
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prize_orders" DROP COLUMN IF EXISTS "order_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_orders" DROP COLUMN IF EXISTS "order_type"`,
    );
  }
}
