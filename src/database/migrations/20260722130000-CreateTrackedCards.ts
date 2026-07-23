import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tracked cards — the card-research universe for market analysis (forecasts,
 * market profiles, deep dives), replacing the retired marketplace catalog as
 * the card source. `ownerUserId` is reserved for per-user saved cards when
 * sign-ups reopen.
 */
export class CreateTrackedCards20260722130000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tracked_cards" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "name" character varying(300) NOT NULL,
        "brand" character varying(50),
        "category" character varying(50),
        "grade" character varying(50),
        "notes" text,
        "ownerUserId" uuid,
        "addedByAdminId" uuid,
        CONSTRAINT "PK_tracked_cards" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_tracked_cards_name" ON "tracked_cards" ("name")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_tracked_cards_owner" ON "tracked_cards" ("ownerUserId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tracked_cards"`);
  }
}
