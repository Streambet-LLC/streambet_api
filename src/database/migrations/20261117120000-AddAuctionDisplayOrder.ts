import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marketplace order (2026-11-17, Nick asked to reorder lots): the position an
 * admin gives a lot in the admin "Reorder" dialog. The marketplace's default
 * sort shows featured lots first, then this order (low first), then lots with
 * no position by the usual time order. Null for every lot until someone
 * reorders.
 */
export class AddAuctionDisplayOrder20261117120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "display_order" integer NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auctions" DROP COLUMN IF EXISTS "display_order"`,
    );
  }
}
