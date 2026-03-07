import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to fix display flags for admin redemption items and remove unused columns.
 * 
 * IMPORTANT: Use show_on_shop (not created_by) to differentiate item types:
 * - show_on_shop = true  → seller shop item (seller_id in created_by)
 * - show_on_shop = false → admin redemption item (created_by tracks who created it)
 * 
 * This allows created_by to always track the creator for audit purposes,
 * while show_on_shop determines if it's available for purchase on seller shops.
 */
export class ClearSellerOwnershipFromRedemptionItems20260303000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fix display flags for admin redemption items
    // All items with show_on_redemptions = true should have show_on_shop = false
    // These are CardCade redemption prizes, not seller shop items
    await queryRunner.query(`
      UPDATE "prize_configurations"
      SET 
        "show_on_shop" = false
      WHERE "show_on_redemptions" = true
    `);

    // Drop the unused show_on_nicks_niceties column
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN IF EXISTS "show_on_nicks_niceties"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This is a data fix, not reversible - do nothing on down
  }
}
