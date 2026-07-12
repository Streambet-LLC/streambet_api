import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persisted Insights chat exchanges (question → answer) for history.
 */
export class CreateInsightsExchanges20260712120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "insights_exchanges" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "conversationId" uuid NOT NULL,
        "question" text NOT NULL,
        "answer" text NOT NULL,
        "tools" jsonb,
        "requestedByAdminId" uuid,
        CONSTRAINT "PK_insights_exchanges" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_insights_exchanges_conversation"
      ON "insights_exchanges" ("conversationId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_insights_exchanges_created"
      ON "insights_exchanges" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "insights_exchanges"`);
  }
}
