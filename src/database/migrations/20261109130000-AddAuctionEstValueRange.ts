import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hermes Est. Value as a range (2026-11-09). `est_value_usd` stays and is the
 * single value, or the low end when `est_value_high_usd` is set. Existing
 * lots keep a single value (high = null).
 */
export class AddAuctionEstValueRange20261109130000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
        ADD COLUMN IF NOT EXISTS "est_value_high_usd" numeric(12,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
        DROP COLUMN IF EXISTS "est_value_high_usd"
    `);
  }
}
