import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The market-taxonomy backbone table — one adjacency-list hierarchy
 * (market → sub-category → set → card) plus cross-cutting player/character
 * subject nodes. Both eBay heat metrics and first-party engagement hang off
 * these nodes so every metric can slice by any dimension.
 */
export class CreateMarketTaxonomy20260827120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "market_taxonomy" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "kind" character varying(24) NOT NULL,
        "rootMarket" character varying(64) NOT NULL,
        "parentKey" character varying(128),
        "key" character varying(128) NOT NULL,
        "label" character varying(160) NOT NULL,
        "matchTerms" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "query" character varying(255),
        "heatScope" character varying(24),
        "curated" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "extra" jsonb,
        CONSTRAINT "PK_market_taxonomy" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_market_taxonomy_key" UNIQUE ("key")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_taxonomy_root" ON "market_taxonomy" ("rootMarket")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_taxonomy_kind" ON "market_taxonomy" ("kind")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_taxonomy_parent" ON "market_taxonomy" ("parentKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "market_taxonomy"`);
  }
}
