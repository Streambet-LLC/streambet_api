import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEbaySoldMarketDataFoundation20260501110000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN IF NOT EXISTS "ebay_search_query" varchar(255),
      ADD COLUMN IF NOT EXISTS "ebay_market_last_calculated_at" TIMESTAMP;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prize_item_ebay_sync_state" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "item_id" uuid NOT NULL UNIQUE,
        "last_fetch_attempted_at" TIMESTAMP NULL,
        "last_fetch_succeeded_at" TIMESTAMP NULL,
        "last_seen_sold_at" TIMESTAMP NULL,
        "last_seen_provider_item_id" varchar(128) NULL,
        "next_fetch_at" TIMESTAMP NULL,
        "last_calculated_at" TIMESTAMP NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_prize_item_ebay_sync_state_item" FOREIGN KEY ("item_id")
          REFERENCES "prize_configurations"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_prize_item_ebay_sync_state_next_fetch"
      ON "prize_item_ebay_sync_state" ("next_fetch_at");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prize_item_ebay_sold_listings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "item_id" uuid NOT NULL,
        "provider_item_id" varchar(128) NULL,
        "source" varchar(64) NOT NULL DEFAULT 'scrapechain',
        "search_query" varchar(255) NOT NULL,
        "sold_title" varchar(500) NOT NULL,
        "sale_price" numeric(12,2) NOT NULL,
        "currency_symbol" varchar(16) NULL,
        "date_sold" TIMESTAMP NULL,
        "image_url" varchar(1000) NULL,
        "listing_url" varchar(1000) NULL,
        "shipping_price" numeric(12,2) NULL,
        "item_condition" varchar(120) NULL,
        "buying_format" varchar(120) NULL,
        "response_url" text NULL,
        "raw_payload" jsonb NULL,
        "fetched_at" TIMESTAMP NOT NULL DEFAULT now(),
        "is_inaccurate" boolean NOT NULL DEFAULT false,
        "inaccurate_reason" text NULL,
        "inaccurate_flagged_by_user_id" uuid NULL,
        "inaccurate_flagged_at" TIMESTAMP NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_prize_item_ebay_sold_listings_item" FOREIGN KEY ("item_id")
          REFERENCES "prize_configurations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_prize_item_ebay_sold_listings_flagged_by" FOREIGN KEY ("inaccurate_flagged_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_prize_item_ebay_sold_listings_item_date"
      ON "prize_item_ebay_sold_listings" ("item_id", "date_sold");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_prize_item_ebay_sold_listings_item_validity"
      ON "prize_item_ebay_sold_listings" ("item_id", "is_inaccurate", "date_sold");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_prize_item_ebay_sold_listings_provider_item_id"
      ON "prize_item_ebay_sold_listings" ("provider_item_id");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_prize_item_ebay_sold_listings_item_provider"
      ON "prize_item_ebay_sold_listings" ("item_id", "provider_item_id")
      WHERE "provider_item_id" IS NOT NULL;
    `);

    /**
     * Per-user reports table: tracks user-submitted reports of sold listings.
     * Users report a listing as inaccurate, which creates a pending report.
     * Admin can then approve (remove universally) or reject (restore visibility).
     * Status lifecycle: pending → approved|rejected
     */
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prize_item_ebay_sold_listing_reports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "listing_id" uuid NOT NULL,
        "reporter_user_id" uuid NOT NULL,
        "reason" text NULL,
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "resolved_at" TIMESTAMP NULL,
        "resolved_by_user_id" uuid NULL,
        "resolution_note" text NULL,
        CONSTRAINT "FK_ebay_sold_listing_reports_listing" FOREIGN KEY ("listing_id")
          REFERENCES "prize_item_ebay_sold_listings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ebay_sold_listing_reports_reporter" FOREIGN KEY ("reporter_user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ebay_sold_listing_reports_resolved_by" FOREIGN KEY ("resolved_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ebay_sold_listing_reports_listing_status"
      ON "prize_item_ebay_sold_listing_reports" ("listing_id", "status");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ebay_sold_listing_reports_reporter_status"
      ON "prize_item_ebay_sold_listing_reports" ("reporter_user_id", "status");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ebay_sold_listing_reports_status_created"
      ON "prize_item_ebay_sold_listing_reports" ("status", "created_at");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ebay_sold_listing_reports_pending"
      ON "prize_item_ebay_sold_listing_reports" ("listing_id", "reporter_user_id")
      WHERE "status" = 'pending';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_ebay_sold_listing_reports_pending";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ebay_sold_listing_reports_status_created";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ebay_sold_listing_reports_reporter_status";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ebay_sold_listing_reports_listing_status";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "prize_item_ebay_sold_listing_reports";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_prize_item_ebay_sold_listings_item_provider";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_item_ebay_sold_listings_provider_item_id";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_item_ebay_sold_listings_item_validity";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_item_ebay_sold_listings_item_date";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "prize_item_ebay_sold_listings";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_item_ebay_sync_state_next_fetch";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "prize_item_ebay_sync_state";`);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN IF EXISTS "ebay_market_last_calculated_at",
      DROP COLUMN IF EXISTS "ebay_search_query";
    `);
  }
}
