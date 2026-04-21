import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtherToPrizeCategoryEnum20260421000000
  implements MigrationInterface
{
  name = 'AddOtherToPrizeCategoryEnum20260421000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'other' value to the prize_configuration category enum
    await queryRunner.query(`
      ALTER TYPE "prize_category_enum"
      ADD VALUE IF NOT EXISTS 'other'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from enums easily.
    // To fully revert, you would need to recreate the enum type.
    // This is intentionally left as a no-op since 'other' can safely remain.
  }
}
