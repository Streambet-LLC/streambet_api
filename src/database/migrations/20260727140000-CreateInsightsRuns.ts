import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * In-flight chat turns, so a user who leaves mid-answer can return to it.
 * Transient state only — insights_exchanges stays the permanent history.
 * conversationId is UNIQUE: one live run per conversation, each turn
 * overwriting the last, which keeps the table bounded by conversation count.
 */
export class CreateInsightsRuns20260727140000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insights_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "conversationId" uuid NOT NULL,
        "question" text NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'running',
        "answer" text NOT NULL DEFAULT '',
        "tools" jsonb,
        "errorMessage" text,
        "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "finishedAt" TIMESTAMP,
        "requestedByAdminId" uuid,
        CONSTRAINT "PK_insights_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_insights_runs_conversation" ON "insights_runs" ("conversationId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "insights_runs"`);
  }
}
