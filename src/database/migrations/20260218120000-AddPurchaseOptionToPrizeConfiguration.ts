import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPurchaseOptionToPrizeConfiguration20260218120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "prize_purchase_option_enum" AS ENUM ('offers_only', 'buy_only', 'both')`,
    );

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN "purchase_option" "prize_purchase_option_enum" NOT NULL DEFAULT 'both'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN IF EXISTS "purchase_option"
    `);

    await queryRunner.query(`DROP TYPE IF EXISTS "prize_purchase_option_enum"`);
  }
}
