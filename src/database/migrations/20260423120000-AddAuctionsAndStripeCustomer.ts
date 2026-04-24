import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds:
 *   1. `users.stripe_customer_id`              — auction autopay needs a customer id.
 *      We backfill from the most recent subscription row per user where one exists.
 *   2. `prize_configurations.sale_type`        — fixed_price | auction.
 *   3. `prize_configurations.card_value_usd`   — internal card value at auction setup.
 *   4. `auctions` table                        — one row per auctioned item.
 *   5. `auction_bids` table                    — append-only bid log.
 */
export class AddAuctionsAndStripeCustomer20260423120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── users.stripe_customer_id ──────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar(100) NULL;
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_stripe_customer_id"
         ON "users" ("stripe_customer_id")
         WHERE "stripe_customer_id" IS NOT NULL;`,
    );
    // Backfill from existing subscriptions if present (best-effort).
    await queryRunner.query(`
      UPDATE "users" u
         SET "stripe_customer_id" = sub.cust
        FROM (
          SELECT DISTINCT ON ("user_id") "user_id", "stripe_customer_id" AS cust
            FROM "subscriptions"
           WHERE "stripe_customer_id" IS NOT NULL
             AND "stripe_customer_id" NOT LIKE 'admin_grant_%'
           ORDER BY "user_id", "created_at" DESC
        ) sub
       WHERE u."id" = sub."user_id"
         AND u."stripe_customer_id" IS NULL;
    `);

    // ── prize_configurations: sale_type + card_value_usd ──────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "prize_sale_type_enum" AS ENUM ('fixed_price', 'auction');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        ADD COLUMN IF NOT EXISTS "sale_type" "prize_sale_type_enum"
          NOT NULL DEFAULT 'fixed_price',
        ADD COLUMN IF NOT EXISTS "card_value_usd" numeric(12,2) NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_prize_configurations_sale_type"
         ON "prize_configurations" ("sale_type");`,
    );

    // ── auctions ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "auction_status_enum" AS ENUM (
          'scheduled','active','ended','paid','unsold','failed','cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auctions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "prize_configuration_id" uuid NOT NULL,
        "duration_days" integer NOT NULL,
        "starts_at" TIMESTAMPTZ NOT NULL,
        "ends_at" TIMESTAMPTZ NOT NULL,
        "status" "auction_status_enum" NOT NULL DEFAULT 'scheduled',
        "starting_price_usd" numeric(12,2) NOT NULL,
        "reserve_price_usd" numeric(12,2) NULL,
        "card_value_usd" numeric(12,2) NULL,
        "current_bid_usd" numeric(12,2) NULL,
        "current_leader_user_id" uuid NULL,
        "proxy_max_usd" numeric(12,2) NULL,
        "bid_count" integer NOT NULL DEFAULT 0,
        "extension_count" integer NOT NULL DEFAULT 0,
        "winner_user_id" uuid NULL,
        "winning_amount_usd" numeric(12,2) NULL,
        "paid_at" TIMESTAMPTZ NULL,
        "payment_intent_id" varchar(255) NULL,
        "prize_order_id" uuid NULL,
        "created_by" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_auctions_prize_configuration_id"
          UNIQUE ("prize_configuration_id"),
        CONSTRAINT "FK_auctions_prize_configuration"
          FOREIGN KEY ("prize_configuration_id")
          REFERENCES "prize_configurations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_auctions_current_leader"
          FOREIGN KEY ("current_leader_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_auctions_winner"
          FOREIGN KEY ("winner_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_auctions_created_by"
          FOREIGN KEY ("created_by")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_auctions_duration_days"
          CHECK ("duration_days" IN (1, 3, 5, 7))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auctions_status_ends_at"
         ON "auctions" ("status", "ends_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auctions_ends_at"
         ON "auctions" ("ends_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auctions_status"
         ON "auctions" ("status");`,
    );

    // ── auction_bids ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auction_bids" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "auction_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "amount_usd" numeric(12,2) NOT NULL,
        "proxy_max_usd" numeric(12,2) NOT NULL,
        "is_proxy_auto" boolean NOT NULL DEFAULT false,
        "stripe_payment_method_id" varchar(255) NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_auction_bids_auction"
          FOREIGN KEY ("auction_id")
          REFERENCES "auctions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_auction_bids_user"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auction_bids_auction_amount"
         ON "auction_bids" ("auction_id", "amount_usd" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auction_bids_user"
         ON "auction_bids" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auction_bids_auction_created"
         ON "auction_bids" ("auction_id", "createdAt");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auction_bids_auction_created";`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auction_bids_user";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auction_bids_auction_amount";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "auction_bids";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auctions_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auctions_ends_at";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auctions_status_ends_at";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "auctions";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "auction_status_enum";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_configurations_sale_type";`,
    );
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        DROP COLUMN IF EXISTS "card_value_usd",
        DROP COLUMN IF EXISTS "sale_type";
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "prize_sale_type_enum";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_users_stripe_customer_id";`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "stripe_customer_id";`,
    );
  }
}
