import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Real-time market-heat pipeline tables: a listing-lifecycle table (active
 * listings tracked across daily snapshots → days-on-market + sell-through
 * proxy) and a per-segment daily heat-point time series (leading indicators
 * derived from active listings rather than lagging sold comps).
 */
export class CreateMarketHeatTables20260821120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "market_listings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "segment" character varying(24) NOT NULL,
        "source" character varying(16) NOT NULL DEFAULT 'ebay',
        "externalId" character varying(128) NOT NULL,
        "title" text,
        "priceUsd" double precision,
        "currency" character varying(8),
        "url" text,
        "firstSeenAt" TIMESTAMP NOT NULL,
        "lastSeenAt" TIMESTAMP NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "clearedAt" TIMESTAMP,
        CONSTRAINT "PK_market_listings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_market_listing" UNIQUE ("source", "externalId", "segment")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_listings_segment" ON "market_listings" ("segment")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_listings_active" ON "market_listings" ("active")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_listings_lastSeen" ON "market_listings" ("lastSeenAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "market_heat_points" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "segment" character varying(24) NOT NULL,
        "capturedAt" TIMESTAMP NOT NULL,
        "totalActive" integer,
        "totalActiveChangePct" double precision,
        "sampleActive" integer NOT NULL DEFAULT 0,
        "newCount" integer NOT NULL DEFAULT 0,
        "clearedCount" integer NOT NULL DEFAULT 0,
        "clearedRatePct" double precision,
        "medianDaysListed" double precision,
        "agingPct" double precision,
        "medianAskUsd" double precision,
        "askChangePct" double precision,
        "heatScore" integer,
        "sampleQuery" character varying(200),
        "extra" jsonb,
        CONSTRAINT "PK_market_heat_points" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_heat_seg_time" ON "market_heat_points" ("segment", "capturedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "market_heat_points"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "market_listings"`);
  }
}
