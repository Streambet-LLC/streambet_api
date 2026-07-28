import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remember which price target we already emailed about, so the nightly alert
 * job sends once per crossing instead of on every run for as long as the card
 * sits above its target.
 */
export class AddTrackedCardAlertNotified20260728120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tracked_cards"
        ADD COLUMN IF NOT EXISTS "alertNotifiedTargetUsd" double precision,
        ADD COLUMN IF NOT EXISTS "alertNotifiedAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tracked_cards"
        DROP COLUMN IF EXISTS "alertNotifiedTargetUsd",
        DROP COLUMN IF EXISTS "alertNotifiedAt"
    `);
  }
}
