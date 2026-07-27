import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sold cards — the realized side of the portfolio. Cost basis and sale price
 * are frozen per sale so realized P/L stays correct even after the watchlist
 * row is edited or removed (hence no FK on "trackedCardId").
 */
export class CreateSoldCards20260727120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sold_cards" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "name" character varying(300) NOT NULL,
        "brand" character varying(50),
        "category" character varying(50),
        "grade" character varying(50),
        "quantity" integer NOT NULL DEFAULT 1,
        "costBasisUsd" double precision,
        "salePriceUsd" double precision,
        "feesUsd" double precision,
        "platform" character varying(100),
        "soldAt" TIMESTAMP,
        "notes" text,
        "trackedCardId" uuid,
        "ownerUserId" uuid,
        "addedByAdminId" uuid,
        CONSTRAINT "PK_sold_cards" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sold_cards_name" ON "sold_cards" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sold_cards_owner" ON "sold_cards" ("ownerUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sold_cards_tracked" ON "sold_cards" ("trackedCardId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sold_cards_sold_at" ON "sold_cards" ("soldAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sold_cards"`);
  }
}
