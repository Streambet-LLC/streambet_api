import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seller document-ingest: persist uploaded inventory (CSV / Excel / Google
 * Sheets) so admins can match a seller's products against CardCade buyers.
 *
 * Two tables: `seller_inventory_uploads` (one per ingest batch) and
 * `seller_inventory_items` (the rows), with the item → upload FK cascading
 * deletes so removing a batch cleans up its rows.
 */
export class CreateSellerInventory20260619120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "seller_inventory_uploads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "sellerUserId" uuid,
        "sellerLabel" character varying(255),
        "source" character varying(32) NOT NULL DEFAULT 'csv',
        "fileName" character varying(512),
        "rowCount" integer NOT NULL DEFAULT 0,
        "matchedItemCount" integer NOT NULL DEFAULT 0,
        "matchedBuyerCount" integer NOT NULL DEFAULT 0,
        "createdByAdminId" uuid,
        CONSTRAINT "PK_seller_inventory_uploads" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_seller_inventory_uploads_seller" ON "seller_inventory_uploads" ("sellerUserId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "seller_inventory_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "uploadId" uuid NOT NULL,
        "rowIndex" integer NOT NULL DEFAULT 0,
        "productName" text NOT NULL,
        "normalizedName" text NOT NULL DEFAULT '',
        "sku" character varying(255),
        "setName" character varying(255),
        "condition" character varying(128),
        "grade" character varying(64),
        "quantity" integer,
        "priceUsd" numeric(12,2),
        "raw" jsonb,
        "matchedBuyerCount" integer NOT NULL DEFAULT 0,
        "matchedProductIds" jsonb,
        CONSTRAINT "PK_seller_inventory_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_seller_inventory_items_upload" FOREIGN KEY ("uploadId")
          REFERENCES "seller_inventory_uploads" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_seller_inventory_items_upload" ON "seller_inventory_items" ("uploadId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_seller_inventory_items_normalized" ON "seller_inventory_items" ("normalizedName")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "seller_inventory_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "seller_inventory_uploads"`);
  }
}
