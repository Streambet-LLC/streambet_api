import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enrich market snapshots with the specifics collectors actually care about —
 * top movers, upcoming catalysts, and headline sales — all sourced from the
 * existing per-segment research call. Additive jsonb columns; safe on live data.
 */
export class EnrichMarketSnapshots20260717120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "market_snapshots" ADD COLUMN IF NOT EXISTS "movers" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "market_snapshots" ADD COLUMN IF NOT EXISTS "catalysts" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "market_snapshots" ADD COLUMN IF NOT EXISTS "sales" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "market_snapshots" DROP COLUMN IF EXISTS "sales"`,
    );
    await queryRunner.query(
      `ALTER TABLE "market_snapshots" DROP COLUMN IF EXISTS "catalysts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "market_snapshots" DROP COLUMN IF EXISTS "movers"`,
    );
  }
}
