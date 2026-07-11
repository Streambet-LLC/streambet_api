import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backgrounded "deep dive" predictive research jobs surfaced in the Insights
 * Deep Dives panel.
 */
export class CreateDeepResearchJobs20260711140000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "deep_research_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "subject" character varying(300) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "result" jsonb,
        "error" text,
        "requestedByAdminId" uuid,
        "startedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        CONSTRAINT "PK_deep_research_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_deep_research_jobs_status"
      ON "deep_research_jobs" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "deep_research_jobs"`);
  }
}
