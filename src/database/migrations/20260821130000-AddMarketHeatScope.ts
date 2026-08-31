import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generalize market-heat from 6 fixed segments to arbitrary "topics" — a
 * segment, a set, or a single marquee card — all tracked through the same
 * pipeline. Widens the grouping key and adds scope + a human label.
 */
export class AddMarketHeatScope20260821130000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "market_listings" ALTER COLUMN "segment" TYPE character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "market_heat_points" ALTER COLUMN "segment" TYPE character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "market_heat_points" ADD COLUMN IF NOT EXISTS "scope" character varying(16) NOT NULL DEFAULT 'segment'`,
    );
    await queryRunner.query(
      `ALTER TABLE "market_heat_points" ADD COLUMN IF NOT EXISTS "label" character varying(120)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_market_heat_scope" ON "market_heat_points" ("scope")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_market_heat_scope"`);
    await queryRunner.query(`ALTER TABLE "market_heat_points" DROP COLUMN IF EXISTS "label"`);
    await queryRunner.query(`ALTER TABLE "market_heat_points" DROP COLUMN IF EXISTS "scope"`);
  }
}
