import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emergency fix to restore redemption items.
 *
 * 1. Deactivate older duplicates (keep only the newest per created_by, prize_tier)
 * 2. Mark all redemption items as active
 * These are the admin-created prizes that users should be able to redeem.
 */
export class FixRedemptionItemsActive20260306000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Drop both unique constraints temporarily
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_prize_configurations_admin_unique_tier"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_prize_configurations_seller_unique_tier"
    `);

    // Step 2: Ensure redemption items (show_on_redemptions = true) have created_by = NULL
    await queryRunner.query(`
      UPDATE "prize_configurations"
      SET "created_by" = NULL
      WHERE "show_on_redemptions" = true
    `);

    // Step 3: For admin items, keep only newest version per prize_tier
    await queryRunner.query(`
      DELETE FROM "prize_configurations"
      WHERE "created_by" IS NULL
      AND id NOT IN (
        SELECT DISTINCT ON ("prize_tier") id
        FROM "prize_configurations"
        WHERE "created_by" IS NULL
        ORDER BY "prize_tier", "createdAt" DESC
      )
    `);

    // Step 4: For seller items, keep only newest version per (created_by, prize_tier)
    await queryRunner.query(`
      DELETE FROM "prize_configurations"
      WHERE "created_by" IS NOT NULL
      AND id NOT IN (
        SELECT DISTINCT ON ("created_by", "prize_tier") id
        FROM "prize_configurations"
        WHERE "created_by" IS NOT NULL
        ORDER BY "created_by", "prize_tier", "createdAt" DESC
      )
    `);

    // Step 5: Set all items as active
    await queryRunner.query(`
      UPDATE "prize_configurations"
      SET "is_active" = true
    `);

    // Step 6: Recreate unique constraints
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_prize_configurations_admin_unique_tier" 
      ON "prize_configurations" ("prize_tier") 
      WHERE "is_active" = true AND "created_by" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_prize_configurations_seller_unique_tier" 
      ON "prize_configurations" ("created_by", "prize_tier") 
      WHERE "is_active" = true AND "created_by" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This is a data fix, not reversible - do nothing on down
  }
}
