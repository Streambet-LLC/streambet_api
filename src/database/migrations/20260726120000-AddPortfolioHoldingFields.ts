import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turn tracked cards into portfolio holdings: cost basis + quantity + acquired
 * date, plus a cached latest valuation so the portfolio view can show live
 * value and gain/loss without re-valuing on every load.
 */
export class AddPortfolioHoldingFields20260726120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tracked_cards"
        ADD COLUMN IF NOT EXISTS "quantity" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "costBasisUsd" double precision,
        ADD COLUMN IF NOT EXISTS "acquiredAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "lastValueUsd" double precision,
        ADD COLUMN IF NOT EXISTS "lastConfidencePct" integer,
        ADD COLUMN IF NOT EXISTS "lastValuedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "lastValuation" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tracked_cards"
        DROP COLUMN IF EXISTS "quantity",
        DROP COLUMN IF EXISTS "costBasisUsd",
        DROP COLUMN IF EXISTS "acquiredAt",
        DROP COLUMN IF EXISTS "lastValueUsd",
        DROP COLUMN IF EXISTS "lastConfidencePct",
        DROP COLUMN IF EXISTS "lastValuedAt",
        DROP COLUMN IF EXISTS "lastValuation"
    `);
  }
}
