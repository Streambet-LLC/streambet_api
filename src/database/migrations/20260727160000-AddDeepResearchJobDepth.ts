import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record the depth a deep dive ran at.
 *
 * The 24h reuse cache matched on subject alone, so switching Brief → Deep and
 * re-running the same card handed back the old Brief report — the depth
 * setting appeared to do nothing. Storing depth lets reuse require a report at
 * least as deep as the one being asked for.
 *
 * Existing rows stay NULL and are ranked as 'balanced' — depth was never
 * recorded for them, so their true depth is unknowable.
 */
export class AddDeepResearchJobDepth20260727160000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "deep_research_jobs"
        ADD COLUMN IF NOT EXISTS "depth" character varying(16)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "deep_research_jobs" DROP COLUMN IF EXISTS "depth"
    `);
  }
}
