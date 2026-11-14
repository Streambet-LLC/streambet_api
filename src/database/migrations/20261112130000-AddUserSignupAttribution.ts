import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Signup attribution (2026-11-12, Meta ads brief): the first-touch UTM params
 * and fbclid a visitor landed with, saved on the account at signup so we can
 * see which ad/campaign it came from. Null for accounts created before this
 * or without any tagged landing.
 */
export class AddUserSignupAttribution20261112130000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_attribution" jsonb NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "signup_attribution"`,
    );
  }
}
