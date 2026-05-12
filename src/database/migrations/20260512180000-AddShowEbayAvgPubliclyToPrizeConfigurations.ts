import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `prize_configurations.show_ebay_avg_publicly` to enable per-item
 * control over whether eBay sold average data is visible to all users
 * (not just admins) on item cards.
 * 
 * Defaults to FALSE to preserve existing behavior where eBay data visibility
 * is controlled only by global feature flags. Admins can selectively enable
 * this flag for specific items to surface market data to end users.
 */
export class AddShowEbayAvgPubliclyToPrizeConfigurations20260512180000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        ADD COLUMN IF NOT EXISTS "show_ebay_avg_publicly" boolean
          NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        DROP COLUMN IF EXISTS "show_ebay_avg_publicly";
    `);
  }
}
