import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hermes Auctions — admin-hosted, zero-fee collectibles auctions.
 *
 *  - auctions become standalone: title/description/category/media live on
 *    the auction itself, so `prize_configuration_id` is now optional (legacy
 *    shop-item auctions keep their link).
 *  - length is 7/14/21 days or a custom end, so the old 1/3/5/7 CHECK goes.
 *  - est. value (manual or pulled from comps), flat shipping, and the
 *    settlement snapshot (method, card fee, total, address, fulfillment).
 *  - bids record how they're funded (card / ach / usdc).
 *  - `auction_crypto_deposits` mirrors each bidder's on-chain USDC escrow.
 */
export class AddHermesAuctions20261101120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "auction_category_enum" AS ENUM ('sports_cards', 'tcg', 'sports_memorabilia');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "auctions" DROP CONSTRAINT IF EXISTS "CHK_auctions_duration_days"`,
    );
    await queryRunner.query(`
      ALTER TABLE "auctions"
        ALTER COLUMN "prize_configuration_id" DROP NOT NULL,
        ALTER COLUMN "duration_days" DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS "title" character varying(200),
        ADD COLUMN IF NOT EXISTS "description" text,
        ADD COLUMN IF NOT EXISTS "category" "auction_category_enum",
        ADD COLUMN IF NOT EXISTS "images" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS "videos" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS "length_preset" character varying(16),
        ADD COLUMN IF NOT EXISTS "est_value_usd" numeric(12,2),
        ADD COLUMN IF NOT EXISTS "est_value_source" character varying(16),
        ADD COLUMN IF NOT EXISTS "est_value_meta" jsonb,
        ADD COLUMN IF NOT EXISTS "shipping_usd" numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "is_featured" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "payment_method" character varying(16),
        ADD COLUMN IF NOT EXISTS "card_fee_usd" numeric(12,2),
        ADD COLUMN IF NOT EXISTS "total_charged_usd" numeric(12,2),
        ADD COLUMN IF NOT EXISTS "payment_due_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "declined_user_ids" uuid[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "shipping_address" jsonb,
        ADD COLUMN IF NOT EXISTS "fulfillment_status" character varying(24) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS "carrier" character varying(64),
        ADD COLUMN IF NOT EXISTS "tracking_number" character varying(128),
        ADD COLUMN IF NOT EXISTS "shipped_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "onchain_auction" character varying(64)
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auctions_category_status" ON "auctions" ("category", "status")`,
    );

    await queryRunner.query(`
      ALTER TABLE "auction_bids"
        ADD COLUMN IF NOT EXISTS "funding_method" character varying(16) NOT NULL DEFAULT 'card',
        ADD COLUMN IF NOT EXISTS "crypto_wallet" character varying(64)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auction_crypto_deposits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "auction_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "wallet" character varying(64) NOT NULL,
        "escrow_address" character varying(64) NOT NULL,
        "amount_usd" numeric(12,2) NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL DEFAULT 'held',
        "deposit_signatures" jsonb NOT NULL DEFAULT '[]',
        "refund_signature" character varying(128),
        "settle_signature" character varying(128),
        "settled_amount_usd" numeric(12,2),
        CONSTRAINT "UQ_auction_crypto_deposits_auction_user" UNIQUE ("auction_id", "user_id"),
        CONSTRAINT "FK_auction_crypto_deposits_auction" FOREIGN KEY ("auction_id")
          REFERENCES "auctions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_auction_crypto_deposits_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auction_crypto_deposits_status" ON "auction_crypto_deposits" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "auction_crypto_deposits"`);
    await queryRunner.query(`
      ALTER TABLE "auction_bids"
        DROP COLUMN IF EXISTS "funding_method",
        DROP COLUMN IF EXISTS "crypto_wallet"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auctions_category_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "auctions"
        DROP COLUMN IF EXISTS "title",
        DROP COLUMN IF EXISTS "description",
        DROP COLUMN IF EXISTS "category",
        DROP COLUMN IF EXISTS "images",
        DROP COLUMN IF EXISTS "videos",
        DROP COLUMN IF EXISTS "length_preset",
        DROP COLUMN IF EXISTS "est_value_usd",
        DROP COLUMN IF EXISTS "est_value_source",
        DROP COLUMN IF EXISTS "est_value_meta",
        DROP COLUMN IF EXISTS "shipping_usd",
        DROP COLUMN IF EXISTS "is_featured",
        DROP COLUMN IF EXISTS "payment_method",
        DROP COLUMN IF EXISTS "card_fee_usd",
        DROP COLUMN IF EXISTS "total_charged_usd",
        DROP COLUMN IF EXISTS "payment_due_at",
        DROP COLUMN IF EXISTS "declined_user_ids",
        DROP COLUMN IF EXISTS "shipping_address",
        DROP COLUMN IF EXISTS "fulfillment_status",
        DROP COLUMN IF EXISTS "carrier",
        DROP COLUMN IF EXISTS "tracking_number",
        DROP COLUMN IF EXISTS "shipped_at",
        DROP COLUMN IF EXISTS "onchain_auction"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "auction_category_enum"`);
    // prize_configuration_id / duration_days stay nullable and the 1/3/5/7
    // CHECK is not restored: Hermes rows would violate both.
  }
}
