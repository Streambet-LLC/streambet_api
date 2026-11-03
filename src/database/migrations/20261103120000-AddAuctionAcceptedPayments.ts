import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hermes Auctions: per-auction payment rails. `fiat` = card + bank (ACH),
 * `crypto` = USDC escrow, `both` = everything (existing rows).
 */
export class AddAuctionAcceptedPayments20261103120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
        ADD COLUMN IF NOT EXISTS "accepted_payments" character varying(8) NOT NULL DEFAULT 'both'
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "auctions" ADD CONSTRAINT "CHK_auctions_accepted_payments"
          CHECK ("accepted_payments" IN ('fiat', 'crypto', 'both'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auctions" DROP CONSTRAINT IF EXISTS "CHK_auctions_accepted_payments"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auctions" DROP COLUMN IF EXISTS "accepted_payments"`,
    );
  }
}
