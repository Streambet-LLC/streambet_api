import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRawToPrizeCategoryEnum1776000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'raw' value to the prize_configuration category enum
    await queryRunner.query(`
      ALTER TYPE "prize_category_enum"
      ADD VALUE IF NOT EXISTS 'raw' BEFORE 'slab'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from enums easily.
    // To fully revert, you would need to recreate the enum type.
    // This is intentionally left as a no-op since 'raw' can safely remain.
  }
}
