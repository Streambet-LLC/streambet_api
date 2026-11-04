import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hermes Auctions display options:
 *  - show_est_value: the creator can hide Est. Value from bidders (admins
 *    still see it).
 *  - seller_name: who bidders see as the seller ("Sold by …"); null shows
 *    the house name, Hermes Auctions.
 */
export class AddAuctionDisplayOptions20261103130000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
        ADD COLUMN IF NOT EXISTS "show_est_value" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "seller_name" character varying(80)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
        DROP COLUMN IF EXISTS "show_est_value",
        DROP COLUMN IF EXISTS "seller_name"
    `);
  }
}
