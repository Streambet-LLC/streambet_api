import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds three groups of missing columns that were added to entities but never migrated:
 *
 * 1. users.is_seller — boolean flag set when a seller application is approved.
 *    Missing column causes the JWT auth guard to crash on every guarded endpoint
 *    (TypeORM SELECTs the column even before service logic runs).
 *
 * 2. prize_configurations — three display/visibility columns added after the brand
 *    migration but never included in a migration:
 *      - display_order
 *      - show_on_redemptions
 *      - show_on_nicks_niceties
 *
 * 3. creator_applications — seller-specific and admin-review columns added to the
 *    entity after the original table creation, plus relaxing NOT NULL on socials/message
 *    (seller applications don't require those fields):
 *      - application_type
 *      - collector_background
 *      - city_state
 *      - cards_collected
 *      - card_preference
 *      - application_status
 *      - reviewed_at
 *      - reviewed_by_user_id
 */
export class AddMissingColumnsUsersPrizeCreatorApplications20260227120000
  implements MigrationInterface
{
  name = 'AddMissingColumnsUsersPrizeCreatorApplications20260227120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. users ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "is_seller" boolean NOT NULL DEFAULT false
    `);

    // ─── 2. prize_configurations ─────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN IF NOT EXISTS "display_order" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN IF NOT EXISTS "show_on_redemptions" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN IF NOT EXISTS "show_on_nicks_niceties" boolean NOT NULL DEFAULT true
    `);

    // ─── 3. creator_applications ─────────────────────────────────────────────

    // Distinguish creator vs seller applications
    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ADD COLUMN IF NOT EXISTS "application_type" varchar(50) NOT NULL DEFAULT 'creator'
    `);

    // Seller-specific fields
    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ADD COLUMN IF NOT EXISTS "collector_background" text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ADD COLUMN IF NOT EXISTS "city_state" varchar(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ADD COLUMN IF NOT EXISTS "cards_collected" text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ADD COLUMN IF NOT EXISTS "card_preference" varchar(50) NULL
    `);

    // Admin review fields
    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ADD COLUMN IF NOT EXISTS "application_status" varchar(50) NOT NULL DEFAULT 'pending'
    `);

    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" varchar NULL
    `);

    // Relax NOT NULL on socials and message — seller applications don't require these
    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ALTER COLUMN "socials" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ALTER COLUMN "message" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ─── 3. creator_applications ─────────────────────────────────────────────

    // Re-add NOT NULL (note: will fail if rows have NULL values in these columns)
    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ALTER COLUMN "message" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "creator_applications"
      ALTER COLUMN "socials" SET NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "creator_applications" DROP COLUMN IF EXISTS "reviewed_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creator_applications" DROP COLUMN IF EXISTS "reviewed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creator_applications" DROP COLUMN IF EXISTS "application_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creator_applications" DROP COLUMN IF EXISTS "card_preference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creator_applications" DROP COLUMN IF EXISTS "cards_collected"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creator_applications" DROP COLUMN IF EXISTS "city_state"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creator_applications" DROP COLUMN IF EXISTS "collector_background"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creator_applications" DROP COLUMN IF EXISTS "application_type"`,
    );

    // ─── 2. prize_configurations ─────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" DROP COLUMN IF EXISTS "show_on_nicks_niceties"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" DROP COLUMN IF EXISTS "show_on_redemptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" DROP COLUMN IF EXISTS "display_order"`,
    );

    // ─── 1. users ────────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_seller"`,
    );
  }
}
