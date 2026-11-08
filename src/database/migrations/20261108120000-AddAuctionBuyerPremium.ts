import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hermes Auctions buyer premium:
 *  - buyer_premium_percent: the auction's premium rate on the hammer, set
 *    when it's created and fixed after. Existing rows get 0, so nothing
 *    already listed changes terms.
 *  - buyer_premium_usd: the premium charged, set when a winner is settled.
 */
export class AddAuctionBuyerPremium20261108120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
        ADD COLUMN IF NOT EXISTS "buyer_premium_percent" numeric(5,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "buyer_premium_usd" numeric(12,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
        DROP COLUMN IF EXISTS "buyer_premium_percent",
        DROP COLUMN IF EXISTS "buyer_premium_usd"
    `);
  }
}
