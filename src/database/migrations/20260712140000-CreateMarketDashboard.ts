import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Broader-hobby-market snapshots (charted on the market dashboard) and each
 * admin's saved dashboard configuration.
 */
export class CreateMarketDashboard20260712140000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "market_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "segment" character varying(24) NOT NULL,
        "capturedAt" TIMESTAMP NOT NULL,
        "metrics" jsonb NOT NULL,
        "summary" text,
        "highlights" jsonb,
        "sources" jsonb,
        CONSTRAINT "PK_market_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_market_snapshots_segment_captured"
      ON "market_snapshots" ("segment", "capturedAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "analytics_dashboards" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "adminId" uuid NOT NULL,
        "config" jsonb NOT NULL,
        CONSTRAINT "PK_analytics_dashboards" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_analytics_dashboards_admin" UNIQUE ("adminId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "analytics_dashboards"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "market_snapshots"`);
  }
}
