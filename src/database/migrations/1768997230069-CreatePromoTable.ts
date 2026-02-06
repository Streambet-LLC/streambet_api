import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePromoTable1768997230069 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS promo_codes (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                code varchar(255) NOT NULL,
                currency varchar(255) NOT NULL,
                amount decimal(10,2) DEFAULT 0,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS promo_codes`);
  }
}
