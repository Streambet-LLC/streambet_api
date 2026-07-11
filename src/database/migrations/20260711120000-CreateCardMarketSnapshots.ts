import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Append-only per-card, per-source market readings — the historical price
 * series behind card market profiles and charts.
 */
export class CreateCardMarketSnapshots20260711120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "card_market_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "prizeConfigurationId" uuid NOT NULL,
        "source" character varying(24) NOT NULL,
        "capturedAt" TIMESTAMP NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'USD',
        "medianUsd" double precision,
        "lowUsd" double precision,
        "highUsd" double precision,
        "avgUsd" double precision,
        "sampleCount" integer,
        "meta" jsonb,
        CONSTRAINT "PK_card_market_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_card_market_snapshots_card_captured"
      ON "card_market_snapshots" ("prizeConfigurationId", "capturedAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_card_market_snapshots_card_source_captured"
      ON "card_market_snapshots" ("prizeConfigurationId", "source", "capturedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "card_market_snapshots"`,
    );
  }
}
