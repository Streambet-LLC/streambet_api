import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Normalized external-signal store for the analytics acquisition framework
 * (consented social handles, eBay official-API data, licensed-vendor data).
 * The intelligence layer reads these to reconcile identities and build lists.
 */
export class CreateExternalSignals20260619130000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "external_signals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "userId" uuid,
        "platform" character varying(32) NOT NULL,
        "handle" text NOT NULL,
        "url" text,
        "source" character varying(32) NOT NULL DEFAULT 'consented',
        "signalType" character varying(32) NOT NULL DEFAULT 'handle',
        "label" character varying(255),
        "data" jsonb,
        "confidence" integer,
        "collectedAt" TIMESTAMP,
        CONSTRAINT "PK_external_signals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_external_signal" UNIQUE ("userId", "platform", "handle", "source")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_external_signals_user" ON "external_signals" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_external_signals_platform" ON "external_signals" ("platform")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_external_signals_collected" ON "external_signals" ("collectedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "external_signals"`);
  }
}
