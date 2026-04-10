import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCartDiscountCodeSupport20260409120000
  implements MigrationInterface
{
  name = 'AddCartDiscountCodeSupport20260409120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to promo_codes
    await queryRunner.query(`
      ALTER TABLE promo_codes
        ADD COLUMN IF NOT EXISTS discount_type varchar(20) NOT NULL DEFAULT 'percent',
        ADD COLUMN IF NOT EXISTS discount_percent decimal(5,2),
        ADD COLUMN IF NOT EXISTS discount_amount_cents integer,
        ADD COLUMN IF NOT EXISTS usage_type varchar(20) NOT NULL DEFAULT 'per_account',
        ADD COLUMN IF NOT EXISTS max_uses integer,
        ADD COLUMN IF NOT EXISTS times_used integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS scope varchar(20) NOT NULL DEFAULT 'cart',
        ADD COLUMN IF NOT EXISTS expires_at timestamptz;
    `);

    // Make code unique if not already
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes (code);
    `);

    // Create redemptions table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS discount_code_redemptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        discount_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        discount_cents integer NOT NULL DEFAULT 0,
        stripe_session_id varchar(255),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE (discount_code_id, user_id)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_discount_redemptions_user
        ON discount_code_redemptions (user_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_discount_redemptions_code
        ON discount_code_redemptions (discount_code_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS discount_code_redemptions;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_promo_codes_code;`);
    await queryRunner.query(`
      ALTER TABLE promo_codes
        DROP COLUMN IF EXISTS discount_type,
        DROP COLUMN IF EXISTS discount_percent,
        DROP COLUMN IF EXISTS discount_amount_cents,
        DROP COLUMN IF EXISTS usage_type,
        DROP COLUMN IF EXISTS max_uses,
        DROP COLUMN IF EXISTS times_used,
        DROP COLUMN IF EXISTS is_active,
        DROP COLUMN IF EXISTS scope,
        DROP COLUMN IF EXISTS expires_at;
    `);
  }
}
