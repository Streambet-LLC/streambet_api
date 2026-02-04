import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrizeRedemptionFeatures1767200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add address fields to users table for shipping information
    await queryRunner.query(`
            ALTER TABLE "users" 
            ADD COLUMN "address" varchar(500) NULL,
            ADD COLUMN "address2" varchar(200) NULL,
            ADD COLUMN "zip_code" varchar(20) NULL,
            ADD COLUMN "country" varchar(100) NULL
        `);

    // Add redemption tracking fields to prize_redemptions table
    await queryRunner.query(`
            ALTER TABLE "prize_redemptions"
            ADD COLUMN "prize_tier" integer NOT NULL DEFAULT 1,
            ADD COLUMN "prize_category" varchar(50) NULL,
            ADD COLUMN "shipping_status" varchar(20) NOT NULL DEFAULT 'open',
            ADD COLUMN "tracking_number" varchar(200) NULL,
            ADD COLUMN "shipping_carrier" varchar(100) NULL,
            ADD COLUMN "fulfilled" boolean NOT NULL DEFAULT false,
            ADD COLUMN "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
        `);

    // Add constraint to check shipping_status values
    await queryRunner.query(`
            ALTER TABLE "prize_redemptions"
            ADD CONSTRAINT "chk_shipping_status" 
            CHECK ("shipping_status" IN ('open', 'shipped', 'complete'))
        `);

    // Create index on prize_tier for admin queries (e.g., "show all tier 1 redemptions")
    await queryRunner.query(`
            CREATE INDEX "idx_prize_redemptions_prize_tier" 
            ON "prize_redemptions" ("prize_tier")
        `);

    // Create index on shipping_status for admin filtering
    await queryRunner.query(`
            CREATE INDEX "idx_prize_redemptions_shipping_status" 
            ON "prize_redemptions" ("shipping_status")
        `);

    // Create composite index for checking user's tier redemptions (most important)
    await queryRunner.query(`
            CREATE INDEX "idx_prize_redemptions_user_tier_fulfilled" 
            ON "prize_redemptions" ("user_id", "prize_tier", "fulfilled")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_redemptions_user_tier_fulfilled"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_redemptions_shipping_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_redemptions_prize_tier"`,
    );

    // Drop constraint
    await queryRunner.query(`
            ALTER TABLE "prize_redemptions"
            DROP CONSTRAINT IF EXISTS "chk_shipping_status"
        `);

    // Remove columns from prize_redemptions
    await queryRunner.query(`
            ALTER TABLE "prize_redemptions"
            DROP COLUMN IF EXISTS "updatedAt",
            DROP COLUMN IF EXISTS "fulfilled",
            DROP COLUMN IF EXISTS "shipping_carrier",
            DROP COLUMN IF EXISTS "tracking_number",
            DROP COLUMN IF EXISTS "shipping_status",
            DROP COLUMN IF EXISTS "prize_category",
            DROP COLUMN IF EXISTS "prize_tier"
        `);

    // Remove columns from users
    await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN IF EXISTS "country",
            DROP COLUMN IF EXISTS "zip_code",
            DROP COLUMN IF EXISTS "address2",
            DROP COLUMN IF EXISTS "address"
        `);
  }
}
