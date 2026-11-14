import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hermes watchlist (2026-11-12): one row per (auction, user). The unique
 * constraint's index also serves per-auction counts; the user index serves
 * "my watchlist".
 */
export class AddAuctionWatchers20261112120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auction_watchers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "auction_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_auction_watchers_auction_user" UNIQUE ("auction_id", "user_id"),
        CONSTRAINT "FK_auction_watchers_auction" FOREIGN KEY ("auction_id")
          REFERENCES "auctions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_auction_watchers_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auction_watchers_user" ON "auction_watchers" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auction_watchers_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auction_watchers"`);
  }
}
