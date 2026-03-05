import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPageSpecificDisplayOrders20260304000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Add page-specific display order columns and featured display order (if they don't exist)
    // Check if columns already exist (in case DB_SYNC created them)
    const columnsExist = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'prize_configurations' 
        AND column_name IN ('display_order_shop', 'display_order_redemptions', 'display_order_nicks_niceties', 'featured_display_order')
    `);

    if (columnsExist.length === 0) {
      // Fresh database: add all columns
      await queryRunner.query(`
        ALTER TABLE "prize_configurations"
        ADD COLUMN "display_order_shop" integer DEFAULT NULL,
        ADD COLUMN "display_order_redemptions" integer DEFAULT NULL,
        ADD COLUMN "display_order_nicks_niceties" integer DEFAULT NULL,
        ADD COLUMN "featured_display_order" integer DEFAULT NULL
      `);
    } else if (columnsExist.length < 4) {
      // Partial columns exist, add missing ones individually
      const existingCols = new Set(columnsExist.map((c) => c.column_name));
      if (!existingCols.has('display_order_shop')) {
        await queryRunner.query(`
          ALTER TABLE "prize_configurations" ADD COLUMN "display_order_shop" integer DEFAULT NULL
        `);
      }
      if (!existingCols.has('display_order_redemptions')) {
        await queryRunner.query(`
          ALTER TABLE "prize_configurations" ADD COLUMN "display_order_redemptions" integer DEFAULT NULL
        `);
      }
      if (!existingCols.has('display_order_nicks_niceties')) {
        await queryRunner.query(`
          ALTER TABLE "prize_configurations" ADD COLUMN "display_order_nicks_niceties" integer DEFAULT NULL
        `);
      }
      if (!existingCols.has('featured_display_order')) {
        await queryRunner.query(`
          ALTER TABLE "prize_configurations" ADD COLUMN "featured_display_order" integer DEFAULT NULL
        `);
      }
    }

    // Step 2: Migrate existing data to new columns
    // Check if old display_order column exists
    const oldColumnExists = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'prize_configurations' AND column_name = 'display_order'
    `);

    const orderByClause =
      oldColumnExists.length > 0
        ? 'display_order ASC, prize_tier ASC, id ASC'
        : 'prize_tier ASC, id ASC';

    // Only populate if columns are empty (haven't been populated yet)
    const hasData = await queryRunner.query(`
      SELECT COUNT(*) as count 
      FROM "prize_configurations" 
      WHERE display_order_shop IS NOT NULL OR display_order_redemptions IS NOT NULL
    `);

    if (parseInt(hasData[0].count) === 0) {
      // Migrate SLAB category prizes to shop page
      await queryRunner.query(
        `
        WITH ranked_slabs AS (
          SELECT 
            id,
            ROW_NUMBER() OVER (ORDER BY ${orderByClause}) as new_order
          FROM "prize_configurations"
          WHERE category = 'slab' AND is_active = true AND show_on_shop = true
        )
        UPDATE "prize_configurations" pc
        SET display_order_shop = rs.new_order
        FROM ranked_slabs rs
        WHERE pc.id = rs.id
      `,
      );

      // Migrate SEALED category prizes to shop page
      await queryRunner.query(
        `
        WITH ranked_sealed AS (
          SELECT 
            id,
            ROW_NUMBER() OVER (ORDER BY ${orderByClause}) as new_order
          FROM "prize_configurations"
          WHERE category = 'sealed' AND is_active = true AND show_on_shop = true
        )
        UPDATE "prize_configurations" pc
        SET display_order_shop = rs.new_order
        FROM ranked_sealed rs
        WHERE pc.id = rs.id
      `,
      );

      // Migrate SLAB category prizes to redemptions page
      await queryRunner.query(
        `
        WITH ranked_slabs AS (
          SELECT 
            id,
            ROW_NUMBER() OVER (ORDER BY ${orderByClause}) as new_order
          FROM "prize_configurations"
          WHERE category = 'slab' AND is_active = true AND show_on_redemptions = true
        )
        UPDATE "prize_configurations" pc
        SET display_order_redemptions = rs.new_order
        FROM ranked_slabs rs
        WHERE pc.id = rs.id
      `,
      );

      // Migrate SEALED category prizes to redemptions page
      await queryRunner.query(
        `
        WITH ranked_sealed AS (
          SELECT 
            id,
            ROW_NUMBER() OVER (ORDER BY ${orderByClause}) as new_order
          FROM "prize_configurations"
          WHERE category = 'sealed' AND is_active = true AND show_on_redemptions = true
        )
        UPDATE "prize_configurations" pc
        SET display_order_redemptions = rs.new_order
        FROM ranked_sealed rs
        WHERE pc.id = rs.id
      `,
      );

      // Migrate SLAB category prizes to Nick's Niceties page
      await queryRunner.query(
        `
        WITH ranked_slabs AS (
          SELECT 
            id,
            ROW_NUMBER() OVER (ORDER BY ${orderByClause}) as new_order
          FROM "prize_configurations"
          WHERE category = 'slab' AND is_active = true AND show_on_nicks_niceties = true
        )
        UPDATE "prize_configurations" pc
        SET display_order_nicks_niceties = rs.new_order
        FROM ranked_slabs rs
        WHERE pc.id = rs.id
      `,
      );

      // Migrate SEALED category prizes to Nick's Niceties page
      await queryRunner.query(
        `
        WITH ranked_sealed AS (
          SELECT 
            id,
            ROW_NUMBER() OVER (ORDER BY ${orderByClause}) as new_order
          FROM "prize_configurations"
          WHERE category = 'sealed' AND is_active = true AND show_on_nicks_niceties = true
        )
        UPDATE "prize_configurations" pc
        SET display_order_nicks_niceties = rs.new_order
        FROM ranked_sealed rs
        WHERE pc.id = rs.id
      `,
      );
    }

    // Step 3: Create indexes for performance (if they don't exist)
    // Shop page ordering - separate indexes for slab and sealed
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_shop_order_slab"
      ON "prize_configurations" ("display_order_shop", "id")
      WHERE "is_active" = true 
        AND "show_on_shop" = true 
        AND "category" = 'slab'
        AND "display_order_shop" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_shop_order_sealed"
      ON "prize_configurations" ("display_order_shop", "id")
      WHERE "is_active" = true 
        AND "show_on_shop" = true 
        AND "category" = 'sealed'
        AND "display_order_shop" IS NOT NULL
    `);

    // Redemptions page ordering
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_redemptions_order_slab"
      ON "prize_configurations" ("display_order_redemptions", "id")
      WHERE "is_active" = true 
        AND "show_on_redemptions" = true 
        AND "category" = 'slab'
        AND "display_order_redemptions" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_redemptions_order_sealed"
      ON "prize_configurations" ("display_order_redemptions", "id")
      WHERE "is_active" = true 
        AND "show_on_redemptions" = true 
        AND "category" = 'sealed'
        AND "display_order_redemptions" IS NOT NULL
    `);

    // Nick's Niceties page ordering
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_nicks_order_slab"
      ON "prize_configurations" ("display_order_nicks_niceties", "id")
      WHERE "is_active" = true 
        AND "show_on_nicks_niceties" = true 
        AND "category" = 'slab'
        AND "display_order_nicks_niceties" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_nicks_order_sealed"
      ON "prize_configurations" ("display_order_nicks_niceties", "id")
      WHERE "is_active" = true 
        AND "show_on_nicks_niceties" = true 
        AND "category" = 'sealed'
        AND "display_order_nicks_niceties" IS NOT NULL
    `);

    // Featured carousel ordering
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_featured_order"
      ON "prize_configurations" ("featured_display_order")
      WHERE "featured_display_order" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_active_featured"
      ON "prize_configurations" ("is_active", "featured_display_order")
      WHERE "featured_display_order" IS NOT NULL
    `);

    // Step 4: Drop the old display_order column (if it exists)
    if (oldColumnExists.length > 0) {
      await queryRunner.query(`
        ALTER TABLE "prize_configurations"
        DROP COLUMN "display_order"
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the old display_order column
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL
    `);

    // Migrate shop order back to display_order (prefer shop as the canonical source)
    await queryRunner.query(`
      UPDATE "prize_configurations"
      SET display_order = COALESCE(display_order_shop, display_order_redemptions, display_order_nicks_niceties, 0)
    `);

    // Drop all indexes
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

    // Drop new columns
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN IF EXISTS "featured_display_order",
      DROP COLUMN IF EXISTS "display_order_nicks_niceties",
      DROP COLUMN IF EXISTS "display_order_redemptions",
      DROP COLUMN IF EXISTS "display_order_shop"
    `);
  }
}
