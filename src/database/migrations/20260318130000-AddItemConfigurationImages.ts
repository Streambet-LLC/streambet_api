import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddItemConfigurationImages20260318130000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "item_configuration_images" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "prize_configuration_id" uuid NOT NULL,
        "image_url" varchar(500) NOT NULL,
        "display_order" integer NOT NULL,
        CONSTRAINT "fk_item_configuration_images_prize_configuration_id"
          FOREIGN KEY ("prize_configuration_id") REFERENCES "prize_configurations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_item_configuration_images_prize_configuration_id"
      ON "item_configuration_images" ("prize_configuration_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_item_configuration_images_prize_configuration_id_display_order"
      ON "item_configuration_images" ("prize_configuration_id", "display_order")
    `);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN IF NOT EXISTS "cover_image_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP CONSTRAINT IF EXISTS "fk_prize_configurations_cover_image_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD CONSTRAINT "fk_prize_configurations_cover_image_id"
      FOREIGN KEY ("cover_image_id") REFERENCES "item_configuration_images"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_cover_image_id"
      ON "prize_configurations" ("cover_image_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN IF NOT EXISTS "display_order_seller_shop" integer
    `);

    await queryRunner.query(`
      UPDATE "prize_configurations"
      SET "display_order_seller_shop" = COALESCE("display_order_seller_shop", "display_order_shop")
      WHERE "created_by" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prize_configurations_seller_shop_order"
      ON "prize_configurations" ("created_by", "is_active", "show_on_shop", "display_order_seller_shop")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_prize_configurations_seller_shop_order"
    `);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN IF EXISTS "display_order_seller_shop"
    `);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP CONSTRAINT IF EXISTS "fk_prize_configurations_cover_image_id"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_prize_configurations_cover_image_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN IF EXISTS "cover_image_id"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_item_configuration_images_prize_configuration_id_display_order"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_item_configuration_images_prize_configuration_id"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "item_configuration_images"
    `);
  }
}
