import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGamificationAndPrizeSystem1767053199410
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add lifetime coins earned to wallets for gamification tracking
    await queryRunner.query(`
            ALTER TABLE "wallets" 
            ADD COLUMN "lifetime_coins_earned" decimal(12,3) NOT NULL DEFAULT 0
        `);

    // Create prize_configurations table - each tier gets its own row
    await queryRunner.query(`
            CREATE TABLE "prize_configurations" (
                "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                "prize_tier" integer NOT NULL,
                "amount" decimal(12,3) NOT NULL,
                "name" varchar(255) NOT NULL,
                "description" text NULL,
                "image_url" varchar(500) NULL,
                "is_active" boolean NOT NULL DEFAULT true,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                "created_by" uuid NULL,
                "updated_by" uuid NULL,
                CONSTRAINT "fk_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
                CONSTRAINT "fk_updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
            )
        `);

    // Create unique partial index to ensure only one active tier per level
    await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_prize_configurations_unique_active_tier" 
            ON "prize_configurations" ("prize_tier") 
            WHERE "is_active" = true
        `);

    // Create index on is_active for quick lookup of active configurations
    await queryRunner.query(`
            CREATE INDEX "idx_prize_configurations_is_active" 
            ON "prize_configurations" ("is_active")
        `);

    // Create prize_redemptions table to track user prize achievements
    await queryRunner.query(`
            CREATE TABLE "prize_redemptions" (
                "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                "user_id" uuid NOT NULL,
                "prize_configuration_id" uuid NOT NULL,
                "date_redeemed" TIMESTAMP NOT NULL DEFAULT now(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "fk_prize_redemption_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_prize_redemption_config" FOREIGN KEY ("prize_configuration_id") REFERENCES "prize_configurations"("id") ON DELETE CASCADE
            )
        `);

    // Create indexes for prize_redemptions
    await queryRunner.query(`
            CREATE INDEX "idx_prize_redemptions_user_id" 
            ON "prize_redemptions" ("user_id")
        `);

    await queryRunner.query(`
            CREATE INDEX "idx_prize_redemptions_prize_config_id" 
            ON "prize_redemptions" ("prize_configuration_id")
        `);

    await queryRunner.query(`
            CREATE INDEX "idx_prize_redemptions_user_prize" 
            ON "prize_redemptions" ("user_id", "prize_configuration_id")
        `);

    // Insert default prize tiers (each tier is a separate row)
    // Tier 1: Collector - 500 coins
    await queryRunner.query(`
            INSERT INTO "prize_configurations" (
                "prize_tier",
                "amount",
                "name",
                "description",
                "image_url",
                "is_active",
                "createdAt",
                "updatedAt"
            ) VALUES (
                1,
                500,
                'Collector',
                'Reach 500 lifetime coins to unlock the Collector badge',
                NULL,
                true,
                now(),
                now()
            )
        `);

    // Tier 2: Dealer - 5,000 coins
    await queryRunner.query(`
            INSERT INTO "prize_configurations" (
                "prize_tier",
                "amount",
                "name",
                "description",
                "image_url",
                "is_active",
                "createdAt",
                "updatedAt"
            ) VALUES (
                2,
                5000,
                'Dealer',
                'Reach 5,000 lifetime coins to unlock the Dealer badge',
                NULL,
                true,
                now(),
                now()
            )
        `);

    // Tier 3: Master - 100,000 coins
    await queryRunner.query(`
            INSERT INTO "prize_configurations" (
                "prize_tier",
                "amount",
                "name",
                "description",
                "image_url",
                "is_active",
                "createdAt",
                "updatedAt"
            ) VALUES (
                3,
                100000,
                'Master',
                'Reach 100,000 lifetime coins to unlock the Master badge',
                NULL,
                true,
                now(),
                now()
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse order
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_redemptions_user_prize"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_redemptions_prize_config_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_redemptions_user_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "prize_redemptions"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_is_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_unique_active_tier"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "prize_configurations"`);
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN IF EXISTS "lifetime_coins_earned"`,
    );
  }
}
