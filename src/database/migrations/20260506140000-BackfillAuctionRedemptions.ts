import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill `prize_redemptions` for previously paid CardCade-owned
 * auction wins.
 *
 * Context: before this change, `AuctionsService.createOrderForWinner`
 * created a `prize_orders` row but no matching `prize_redemptions`
 * row. The admin Redemptions panel reads from `prize_redemptions`,
 * so won auctions for CardCade-owned items never showed up there for
 * shipping (tracking #, carrier, status) — even though they should
 * be fulfilled by CardCade ops just like any other shop purchase.
 *
 * Scope:
 *   - Only auctions whose linked PrizeOrder exists AND
 *   - whose PrizeConfiguration is CardCade-owned (`created_by IS NULL`) AND
 *   - that don't already have a redemption row for that order id.
 *
 * Seller-owned auction wins are skipped — sellers fulfill those via
 * the seller dashboard, not the CardCade ops queue.
 *
 * `prize_category` is mapped from the prize's `category` column using
 * the same logic as `ensureRedemptionForOrder` in PrizeService:
 *   sealed → SEALED, raw → RAW, anything else → SLAB.
 */
export class BackfillAuctionRedemptions20260506140000
  implements MigrationInterface
{
  name = 'BackfillAuctionRedemptions20260506140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO prize_redemptions (
        user_id,
        prize_configuration_id,
        prize_order_id,
        prize_tier,
        prize_category,
        shipping_status,
        fulfilled,
        date_redeemed,
        created_at,
        updated_at
      )
      SELECT
        po.user_id,
        po.prize_configuration_id,
        po.id AS prize_order_id,
        pc.prize_tier,
        CASE
          WHEN pc.category::text = 'sealed' THEN 'sealed'
          WHEN pc.category::text = 'raw'    THEN 'raw'
          ELSE 'slab'
        END AS prize_category,
        'open' AS shipping_status,
        false AS fulfilled,
        COALESCE(po.created_at, NOW()) AS date_redeemed,
        NOW() AS created_at,
        NOW() AS updated_at
      FROM prize_orders po
      INNER JOIN auctions a
              ON a.prize_order_id = po.id
      INNER JOIN prize_configurations pc
              ON pc.id = po.prize_configuration_id
      WHERE pc.created_by IS NULL
        AND po.status = 'paid'
        AND NOT EXISTS (
          SELECT 1 FROM prize_redemptions pr
           WHERE pr.prize_order_id = po.id
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove backfilled rows: anything tied to a prize_order whose
    // auction we created here. Safe because we only delete rows whose
    // prize_order_id corresponds to an auction-linked order.
    await queryRunner.query(`
      DELETE FROM prize_redemptions pr
      USING prize_orders po, auctions a
      WHERE pr.prize_order_id = po.id
        AND a.prize_order_id = po.id;
    `);
  }
}
