import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Split the watchlist from holdings. Until now both were the same rows, so
 * every card someone merely watched counted toward portfolio value.
 *
 * Backfill: a recorded cost basis is the best available signal that a card was
 * actually bought, so those become owned. Everything else starts as watch-only,
 * which is the safe direction — it under-claims ownership rather than inventing
 * holdings, and a card is one click from being marked owned.
 */
export class AddTrackedCardOwned20260727150000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tracked_cards"
        ADD COLUMN IF NOT EXISTS "owned" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      UPDATE "tracked_cards" SET "owned" = true WHERE "costBasisUsd" IS NOT NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tracked_cards_owned" ON "tracked_cards" ("owned")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tracked_cards_owned"`);
    await queryRunner.query(
      `ALTER TABLE "tracked_cards" DROP COLUMN IF EXISTS "owned"`,
    );
  }
}
