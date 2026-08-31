import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * First-party engagement snapshots (platform views + saves) rolled up to
 * taxonomy nodes and charted over time — the reliable, free signal we uniquely
 * own, complementing the external eBay heat points.
 */
export class CreateMarketEngagement20260827130000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "market_engagement_points" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "segment" character varying(64) NOT NULL,
        "scope" character varying(24) NOT NULL DEFAULT 'segment',
        "label" character varying(160),
        "capturedAt" TIMESTAMP NOT NULL,
        "itemCount" integer NOT NULL DEFAULT 0,
        "totalViews" integer NOT NULL DEFAULT 0,
        "totalWatchers" integer NOT NULL DEFAULT 0,
        "newViews7d" integer NOT NULL DEFAULT 0,
        "newWatchers7d" integer NOT NULL DEFAULT 0,
        "viewsChangePct" double precision,
        "watchersChangePct" double precision,
        "extra" jsonb,
        CONSTRAINT "PK_market_engagement_points" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_engagement_seg_time" ON "market_engagement_points" ("segment", "capturedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_engagement_scope" ON "market_engagement_points" ("scope")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "market_engagement_points"`);
  }
}
