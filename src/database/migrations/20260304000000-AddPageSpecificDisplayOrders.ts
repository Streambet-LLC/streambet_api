import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPageSpecificDisplayOrders20260304000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Add all new display order and sorting preference columns
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN "display_order_shop" integer DEFAULT NULL,
      ADD COLUMN "display_order_redemptions" integer DEFAULT NULL,
      ADD COLUMN "display_order_nicks_niceties" integer DEFAULT NULL,
      ADD COLUMN "featured_display_order" integer DEFAULT NULL,
      ADD COLUMN "sort_by_purchase_option_shop" boolean DEFAULT false,
      ADD COLUMN "sort_by_purchase_option_redemptions" boolean DEFAULT false,
      ADD COLUMN "sort_by_purchase_option_nicks_niceties" boolean DEFAULT false
    `);

    // Step 2: Create indexes for performance
    // Shop page ordering - separate indexes for slab and sealed
    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_shop_order_slab"
      ON "prize_configurations" ("display_order_shop", "id")
      WHERE "is_active" = true 
        AND "show_on_shop" = true 
        AND "category" = 'slab'
        AND "display_order_shop" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_shop_order_sealed"
      ON "prize_configurations" ("display_order_shop", "id")
      WHERE "is_active" = true 
        AND "show_on_shop" = true 
        AND "category" = 'sealed'
        AND "display_order_shop" IS NOT NULL
    `);

    // Redemptions page ordering
    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_redemptions_order_slab"
      ON "prize_configurations" ("display_order_redemptions", "id")
      WHERE "is_active" = true 
        AND "show_on_redemptions" = true 
        AND "category" = 'slab'
        AND "display_order_redemptions" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_redemptions_order_sealed"
      ON "prize_configurations" ("display_order_redemptions", "id")
      WHERE "is_active" = true 
        AND "show_on_redemptions" = true 
        AND "category" = 'sealed'
        AND "display_order_redemptions" IS NOT NULL
    `);

    // Nick's Niceties page ordering
    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_nicks_order_slab"
      ON "prize_configurations" ("display_order_nicks_niceties", "id")
      WHERE "is_active" = true 
        AND "show_on_nicks_niceties" = true 
        AND "category" = 'slab'
        AND "display_order_nicks_niceties" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_nicks_order_sealed"
      ON "prize_configurations" ("display_order_nicks_niceties", "id")
      WHERE "is_active" = true 
        AND "show_on_nicks_niceties" = true 
        AND "category" = 'sealed'
        AND "display_order_nicks_niceties" IS NOT NULL
    `);

    // Featured carousel ordering
    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_featured_order"
      ON "prize_configurations" ("featured_display_order")
      WHERE "featured_display_order" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_prize_configurations_active_featured"
      ON "prize_configurations" ("is_active", "featured_display_order")
      WHERE "featured_display_order" IS NOT NULL
    `);

    // Step 3: Drop the old unused display_order column
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN "display_order"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Restore the old display_order column
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL
    `);

    // Step 2: Drop all indexes
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_active_featured"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_featured_order"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_nicks_order_sealed"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_nicks_order_slab"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_redemptions_order_sealed"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_redemptions_order_slab"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_shop_order_sealed"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prize_configurations_shop_order_slab"`,
    );

    // Step 3: Drop all new columns
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN IF EXISTS "sort_by_purchase_option_nicks_niceties",
      DROP COLUMN IF EXISTS "sort_by_purchase_option_redemptions",
      DROP COLUMN IF EXISTS "sort_by_purchase_option_shop",
      DROP COLUMN IF EXISTS "featured_display_order",
      DROP COLUMN IF EXISTS "display_order_nicks_niceties",
      DROP COLUMN IF EXISTS "display_order_redemptions",
      DROP COLUMN IF EXISTS "display_order_shop"
    `);
  }
}
