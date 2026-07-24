import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-operation Anthropic (Claude) usage + cost log — powers the admin Usage
 * tab (prompts, tokens, and estimated spend by user and prompt type).
 */
export class CreateClaudeUsageLogs20260723140000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "claude_usage_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "feature" character varying(40) NOT NULL,
        "adminId" uuid,
        "model" character varying(48) NOT NULL,
        "inputTokens" integer NOT NULL DEFAULT 0,
        "outputTokens" integer NOT NULL DEFAULT 0,
        "cacheReadTokens" integer NOT NULL DEFAULT 0,
        "cacheWriteTokens" integer NOT NULL DEFAULT 0,
        "webSearches" integer NOT NULL DEFAULT 0,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        CONSTRAINT "PK_claude_usage_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_claude_usage_logs_feature"
      ON "claude_usage_logs" ("feature")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_claude_usage_logs_adminId"
      ON "claude_usage_logs" ("adminId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_claude_usage_logs_createdAt"
      ON "claude_usage_logs" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "claude_usage_logs"`);
  }
}
