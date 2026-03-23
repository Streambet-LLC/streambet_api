import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateFeeStructure20260321000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update the default for new sellers from 7% to 4%
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "application_fee_percent" SET DEFAULT 4
    `);

    // Update all existing sellers to the new 4% fee
    await queryRunner.query(`
      UPDATE "users"
      SET "application_fee_percent" = 4
      WHERE "is_seller" = true AND "application_fee_percent" = 7
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert default back to 7%
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "application_fee_percent" SET DEFAULT 7
    `);

    // Revert sellers back to 7%
    await queryRunner.query(`
      UPDATE "users"
      SET "application_fee_percent" = 7
      WHERE "is_seller" = true AND "application_fee_percent" = 4
    `);
  }
}
