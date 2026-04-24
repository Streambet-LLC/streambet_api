import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `prize_configurations.shipping_cost_usd` so admins can specify a
 * per-item shipping fee. Defaults to $5.00 to match the previous
 * hard-coded constant. Existing rows (including live auction items) are
 * backfilled to $5.00 via the column DEFAULT.
 */
export class AddItemShippingCost20260423140000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        ADD COLUMN IF NOT EXISTS "shipping_cost_usd" numeric(12,2)
          NOT NULL DEFAULT 5.00;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        DROP COLUMN IF EXISTS "shipping_cost_usd";
    `);
  }
}
