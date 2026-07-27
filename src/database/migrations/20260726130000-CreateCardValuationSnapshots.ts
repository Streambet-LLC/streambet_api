import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist every card valuation as a time series — the data moat: per-card
 * price history, cheaper repeats, and (over time) our own indices.
 */
export class CreateCardValuationSnapshots20260726130000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "card_valuation_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "subjectKey" character varying(300) NOT NULL,
        "subject" character varying(300) NOT NULL,
        "pointUsd" double precision,
        "lowUsd" double precision,
        "highUsd" double precision,
        "confidencePct" integer,
        "method" character varying(40),
        "reliability" character varying(20),
        "valuation" jsonb,
        CONSTRAINT "PK_card_valuation_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_card_val_snap_key"
        ON "card_valuation_snapshots" ("subjectKey")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_card_val_snap_key_time"
        ON "card_valuation_snapshots" ("subjectKey", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "card_valuation_snapshots"`,
    );
  }
}
