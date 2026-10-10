import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spike Radar — early detection of cards/markets starting to spike:
 *  - heat points gain floor-sweep readings (p10 ask, its change, and how many
 *    of the cheapest copies a day ago are now gone) plus an own-baseline
 *    spike score and the signals behind it;
 *  - taxonomy nodes gain a watch window, during which they're snapshotted
 *    hourly instead of daily;
 *  - a per-specific-card table, so a broad topic ("LeBron Prizm") can be
 *    broken down into the exact cards inside it.
 */
export class AddSpikeRadar20261009120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "market_heat_points"
        ADD COLUMN IF NOT EXISTS "floorAskUsd" double precision,
        ADD COLUMN IF NOT EXISTS "floorChangePct" double precision,
        ADD COLUMN IF NOT EXISTS "sweptPct" double precision,
        ADD COLUMN IF NOT EXISTS "spikeScore" integer,
        ADD COLUMN IF NOT EXISTS "spikeSignals" jsonb
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_heat_captured" ON "market_heat_points" ("capturedAt")`,
    );

    await queryRunner.query(`
      ALTER TABLE "market_taxonomy"
        ADD COLUMN IF NOT EXISTS "watchUntil" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "watchReason" character varying(160)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "market_variant_points" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "segment" character varying(64) NOT NULL,
        "signature" character varying(160) NOT NULL,
        "label" character varying(160) NOT NULL,
        "capturedAt" TIMESTAMP NOT NULL,
        "listedCount" integer NOT NULL DEFAULT 0,
        "floorUsd" double precision,
        "medianUsd" double precision,
        "clearedCount" integer NOT NULL DEFAULT 0,
        "floorChangePct" double precision,
        "countChangePct" double precision,
        "hot" boolean NOT NULL DEFAULT false,
        "extra" jsonb,
        CONSTRAINT "PK_market_variant_points" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_variant_seg_sig_time" ON "market_variant_points" ("segment", "signature", "capturedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_variant_hot_time" ON "market_variant_points" ("hot", "capturedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "market_variant_points"`);
    await queryRunner.query(`
      ALTER TABLE "market_taxonomy"
        DROP COLUMN IF EXISTS "watchReason",
        DROP COLUMN IF EXISTS "watchUntil"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_market_heat_captured"`);
    await queryRunner.query(`
      ALTER TABLE "market_heat_points"
        DROP COLUMN IF EXISTS "spikeSignals",
        DROP COLUMN IF EXISTS "spikeScore",
        DROP COLUMN IF EXISTS "sweptPct",
        DROP COLUMN IF EXISTS "floorChangePct",
        DROP COLUMN IF EXISTS "floorAskUsd"
    `);
  }
}
