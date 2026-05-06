import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingUpdatedAtToEbayTables20260506000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add updatedAt column to prize_item_ebay_sold_listing_reports if missing
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listing_reports'
            AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listing_reports"
          ADD COLUMN "updatedAt" TIMESTAMP NOT NULL DEFAULT now();
        END IF;
      END
      $$;
    `);

    // Add updatedAt column to prize_item_ebay_sold_listings if missing
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listings'
            AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listings"
          ADD COLUMN "updatedAt" TIMESTAMP NOT NULL DEFAULT now();
        END IF;
      END
      $$;
    `);

    // Add updatedAt column to prize_item_ebay_sync_state if missing
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sync_state'
            AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sync_state"
          ADD COLUMN "updatedAt" TIMESTAMP NOT NULL DEFAULT now();
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove updatedAt column from prize_item_ebay_sold_listing_reports if exists
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listing_reports'
            AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listing_reports"
          DROP COLUMN "updatedAt";
        END IF;
      END
      $$;
    `);

    // Remove updatedAt column from prize_item_ebay_sold_listings if exists
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listings'
            AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listings"
          DROP COLUMN "updatedAt";
        END IF;
      END
      $$;
    `);

    // Remove updatedAt column from prize_item_ebay_sync_state if exists
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sync_state'
            AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sync_state"
          DROP COLUMN "updatedAt";
        END IF;
      END
      $$;
    `);
  }
}
