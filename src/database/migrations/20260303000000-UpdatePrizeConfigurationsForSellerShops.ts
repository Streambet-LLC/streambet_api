import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to support seller-specific shops with independent prize tiers.
 *
 * Changes:
 * 1. Drop the existing unique index on prize_tier (scoped globally)
 * 2. Create two new unique indexes:
 *    - One for admin items (created_by IS NULL) - allows unique tiers per admin
 *    - One for seller items - allows unique tiers per seller (created_by, prize_tier)
 *
 * This allows each seller to have their own independent tier numbering (e.g., tier 1, 2, 3)
 * without conflicting with admin items or other sellers.
 */
export class UpdatePrizeConfigurationsForSellerShops20260303000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the old global unique index on prize_tier
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_prize_configurations_unique_active_tier"
    `);

    // Create unique index for admin items (where created_by IS NULL)
    // This ensures admin can only have one active prize per tier
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_prize_configurations_admin_unique_tier" 
      ON "prize_configurations" ("prize_tier") 
      WHERE "is_active" = true AND "created_by" IS NULL
    `);

    // Create unique index for seller items (scoped per seller)
    // This ensures each seller can only have one active prize per tier in their own shop
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_prize_configurations_seller_unique_tier" 
      ON "prize_configurations" ("created_by", "prize_tier") 
      WHERE "is_active" = true AND "created_by" IS NOT NULL
    `);

    // Create index on created_by for efficient seller shop queries
    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_created_by" 
      ON "prize_configurations" ("created_by")
      WHERE "created_by" IS NOT NULL
    `);

    // Update existing admin items to ensure proper flags
    // Admin redemption items should have created_by = NULL
    await queryRunner.query(`
      UPDATE "prize_configurations" 
      SET 
        "show_on_redemptions" = true,
        "show_on_shop" = false
      WHERE "created_by" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the new indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_prize_configurations_created_by"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_prize_configurations_seller_unique_tier"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_prize_configurations_admin_unique_tier"
    `);

    // Restore the old global unique index
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_prize_configurations_unique_active_tier" 
      ON "prize_configurations" ("prize_tier") 
      WHERE "is_active" = true
    `);
  }
}
