import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStockToPrizeConfiguration20260216160000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add stock column to prize_configurations
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN "stock" integer NOT NULL DEFAULT 0
    `);

    // Create index for filtering by stock availability
    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_stock"
      ON "prize_configurations" ("stock")
    `);

    // Create composite index for checking active items with stock
    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_active_stock"
      ON "prize_configurations" ("is_active", "stock")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_active_stock"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_stock"`,
    );

    // Drop column
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN IF EXISTS "stock"
    `);
  }
}
