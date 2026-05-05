import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameEbayTimestampColumnsToCamelCase20260505201000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sync_state'
            AND column_name = 'created_at'
        ) THEN
          ALTER TABLE "prize_item_ebay_sync_state"
          RENAME COLUMN "created_at" TO "createdAt";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sync_state'
            AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE "prize_item_ebay_sync_state"
          RENAME COLUMN "updated_at" TO "updatedAt";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listings'
            AND column_name = 'created_at'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listings"
          RENAME COLUMN "created_at" TO "createdAt";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listings'
            AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listings"
          RENAME COLUMN "updated_at" TO "updatedAt";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listing_reports'
            AND column_name = 'created_at'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listing_reports"
          RENAME COLUMN "created_at" TO "createdAt";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listing_reports'
            AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listing_reports"
          RENAME COLUMN "updated_at" TO "updatedAt";
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sync_state'
            AND column_name = 'createdAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sync_state"
          RENAME COLUMN "createdAt" TO "created_at";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sync_state'
            AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sync_state"
          RENAME COLUMN "updatedAt" TO "updated_at";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listings'
            AND column_name = 'createdAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listings"
          RENAME COLUMN "createdAt" TO "created_at";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listings'
            AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listings"
          RENAME COLUMN "updatedAt" TO "updated_at";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listing_reports'
            AND column_name = 'createdAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listing_reports"
          RENAME COLUMN "createdAt" TO "created_at";
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prize_item_ebay_sold_listing_reports'
            AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "prize_item_ebay_sold_listing_reports"
          RENAME COLUMN "updatedAt" TO "updated_at";
        END IF;
      END
      $$;
    `);
  }
}
