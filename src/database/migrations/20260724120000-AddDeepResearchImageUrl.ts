import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Store a reference image URL on each deep-research job so the finished AI
 * Market Report can lead with a picture of the confirmed card.
 */
export class AddDeepResearchImageUrl20260724120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "deep_research_jobs"
      ADD COLUMN IF NOT EXISTS "imageUrl" character varying(1000)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "deep_research_jobs" DROP COLUMN IF EXISTS "imageUrl"
    `);
  }
}
