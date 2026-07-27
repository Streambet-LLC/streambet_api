import { MigrationInterface, QueryRunner } from 'typeorm';

/** Thumbs up/down feedback on Cardy answers — the reliability flywheel. */
export class CreateInsightsFeedback20260726150000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insights_feedback" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "rating" character varying(8) NOT NULL,
        "question" text,
        "answer" text,
        "note" text,
        "subject" character varying(300),
        "conversationId" uuid,
        "adminId" uuid,
        CONSTRAINT "PK_insights_feedback" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_insights_feedback_rating"
        ON "insights_feedback" ("rating")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "insights_feedback"`);
  }
}
