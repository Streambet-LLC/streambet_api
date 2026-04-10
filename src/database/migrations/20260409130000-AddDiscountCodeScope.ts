import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDiscountCodeScope20260409130000 implements MigrationInterface {
  name = 'AddDiscountCodeScope20260409130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE promo_codes
        ADD COLUMN IF NOT EXISTS scope varchar(20) NOT NULL DEFAULT 'cart';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE promo_codes
        DROP COLUMN IF EXISTS scope;
    `);
  }
}
