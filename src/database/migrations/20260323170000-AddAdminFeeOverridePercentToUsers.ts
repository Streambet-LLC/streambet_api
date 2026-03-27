import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminFeeOverridePercentToUsers20260323170000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "admin_fee_override_percent" DECIMAL(3,1)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_users_admin_fee_override_percent_range'
        ) THEN
          ALTER TABLE "users"
          ADD CONSTRAINT "chk_users_admin_fee_override_percent_range"
          CHECK (
            "admin_fee_override_percent" IS NULL
            OR (
              "admin_fee_override_percent" >= 2
              AND "admin_fee_override_percent" <= 4
            )
          );
        END IF;
      END;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP CONSTRAINT IF EXISTS "chk_users_admin_fee_override_percent_range"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "admin_fee_override_percent"
    `);
  }
}
