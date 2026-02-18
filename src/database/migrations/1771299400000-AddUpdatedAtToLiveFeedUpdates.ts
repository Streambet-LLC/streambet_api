import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUpdatedAtToLiveFeedUpdates1771299400000 implements MigrationInterface {
  name = 'AddUpdatedAtToLiveFeedUpdates1771299400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add updatedAt column to live_feed_updates table
    await queryRunner.query(`
      ALTER TABLE "live_feed_updates"
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove updatedAt column from live_feed_updates table
    await queryRunner.query(`
      ALTER TABLE "live_feed_updates"
      DROP COLUMN IF EXISTS "updatedAt"
    `);
  }
}
