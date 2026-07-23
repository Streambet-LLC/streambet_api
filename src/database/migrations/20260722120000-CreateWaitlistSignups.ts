import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Public waitlist signups captured on the landing page during private testing.
 */
export class CreateWaitlistSignups20260722120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "waitlist_signups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "email" character varying(320) NOT NULL,
        "name" character varying(200),
        "source" character varying(200),
        "ipAddress" character varying(64),
        CONSTRAINT "PK_waitlist_signups" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_waitlist_signups_email"
      ON "waitlist_signups" ("email")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_waitlist_signups_created"
      ON "waitlist_signups" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "waitlist_signups"`);
  }
}
