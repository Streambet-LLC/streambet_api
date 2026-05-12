import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSellerFeeToTwoPercent20260512000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update column default to 2%
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "application_fee_percent" SET DEFAULT 2
    `);

    // Update all existing sellers to 2%
    await queryRunner.query(`
      UPDATE "users" 
      SET "application_fee_percent" = 2 
      WHERE "application_fee_percent" != 2
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert default back to 4%
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "application_fee_percent" SET DEFAULT 4
    `);
  }
}
