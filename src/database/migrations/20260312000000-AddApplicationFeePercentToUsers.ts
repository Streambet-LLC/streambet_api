import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApplicationFeePercentToUsers20260312000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "application_fee_percent" DECIMAL NOT NULL DEFAULT 7
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "application_fee_percent"
    `);
  }
}
