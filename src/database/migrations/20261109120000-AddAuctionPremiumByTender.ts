import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hermes Auctions buyer fee by tender (2026-11-09): card 4%, ACH 1%,
 * USDC 0.5%, all-in. `buyer_premium_percent` stays and is the card rate;
 * this adds the ACH and USDC rates. Existing lots get the new rates, capped
 * at their current single rate, so no bidder's terms go up (legacy rows at 0
 * stay 0).
 */
export class AddAuctionPremiumByTender20261109120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
        ADD COLUMN IF NOT EXISTS "buyer_premium_ach_percent" numeric(5,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "buyer_premium_usdc_percent" numeric(5,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "auctions"
        SET "buyer_premium_ach_percent" = LEAST("buyer_premium_percent", 1),
            "buyer_premium_usdc_percent" = LEAST("buyer_premium_percent", 0.5)
        WHERE "buyer_premium_percent" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
        DROP COLUMN IF EXISTS "buyer_premium_ach_percent",
        DROP COLUMN IF EXISTS "buyer_premium_usdc_percent"
    `);
  }
}
