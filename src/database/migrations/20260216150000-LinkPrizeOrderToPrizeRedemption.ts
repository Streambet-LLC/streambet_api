import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkPrizeOrderToPrizeRedemption20260216150000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add prize_order_id column to prize_redemptions
    await queryRunner.query(`
      ALTER TABLE "prize_redemptions"
      ADD COLUMN "prize_order_id" uuid NULL
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "prize_redemptions"
      ADD CONSTRAINT "fk_prize_redemption_order"
      FOREIGN KEY ("prize_order_id")
      REFERENCES "prize_orders"("id")
      ON DELETE SET NULL
    `);

    // Create index for faster queries
    await queryRunner.query(`
      CREATE INDEX "idx_prize_redemptions_order_id"
      ON "prize_redemptions" ("prize_order_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_redemptions_order_id"`,
    );

    // Drop foreign key
    await queryRunner.query(`
      ALTER TABLE "prize_redemptions"
      DROP CONSTRAINT IF EXISTS "fk_prize_redemption_order"
    `);

    // Drop column
    await queryRunner.query(`
      ALTER TABLE "prize_redemptions"
      DROP COLUMN IF EXISTS "prize_order_id"
    `);
  }
}
