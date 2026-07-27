import { MigrationInterface, QueryRunner } from 'typeorm';

/** Price-alert targets per holding: notify when value crosses above/below. */
export class AddCardAlertTargets20260726140000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tracked_cards"
        ADD COLUMN IF NOT EXISTS "alertAboveUsd" double precision,
        ADD COLUMN IF NOT EXISTS "alertBelowUsd" double precision
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tracked_cards"
        DROP COLUMN IF EXISTS "alertAboveUsd",
        DROP COLUMN IF EXISTS "alertBelowUsd"
    `);
  }
}
