import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStripeDetailsToUser1772806086078 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "stripe_account_id" VARCHAR(100),
            ADD COLUMN IF NOT EXISTS "stripe_account_connected" BOOLEAN DEFAULT(false)
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "users" 
            DROP COLUMN IF EXISTS "stripe_account_id",
            DROP COLUMN IF EXISTS "stripe_account_connected"
            `);
  }
}
