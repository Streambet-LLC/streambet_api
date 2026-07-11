import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Claude-powered lead qualification: a buy-likelihood score, intent, extracted
 * interests, and rationale on each discovered lead.
 */
export class AddLeadQualification20260703120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "discovered_leads"
         ADD COLUMN IF NOT EXISTS "buyerScore" integer,
         ADD COLUMN IF NOT EXISTS "intent" character varying(24),
         ADD COLUMN IF NOT EXISTS "interests" jsonb,
         ADD COLUMN IF NOT EXISTS "qualifyReasoning" text,
         ADD COLUMN IF NOT EXISTS "qualifiedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_discovered_leads_score" ON "discovered_leads" ("buyerScore")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_discovered_leads_score"`,
    );
    await queryRunner.query(
      `ALTER TABLE "discovered_leads"
         DROP COLUMN IF EXISTS "buyerScore",
         DROP COLUMN IF EXISTS "intent",
         DROP COLUMN IF EXISTS "interests",
         DROP COLUMN IF EXISTS "qualifyReasoning",
         DROP COLUMN IF EXISTS "qualifiedAt"`,
    );
  }
}
