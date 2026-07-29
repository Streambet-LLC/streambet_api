import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sales supplied by the user when our research missed them (Goldin, Fanatics,
 * Heritage, private deals — sources our retrieval never reads). Keyed by the
 * normalized card subject so every future valuation of that card picks them up
 * automatically.
 */
export class CreateUserComps20260728140000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_comps" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "subject" character varying(300) NOT NULL,
        "title" text,
        "priceUsd" double precision NOT NULL,
        "saleDate" character varying(10),
        "grade" character varying(50),
        "sourceType" character varying(50) NOT NULL DEFAULT 'auction-sale',
        "url" text NOT NULL,
        "note" text,
        "verified" boolean NOT NULL DEFAULT false,
        "addedByAdminId" uuid,
        CONSTRAINT "PK_user_comps" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_comps_subject" ON "user_comps" ("subject")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_comps"`);
  }
}
