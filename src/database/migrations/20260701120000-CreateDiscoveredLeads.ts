import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persistent pool of leads surfaced by the Discover engine. Every discovery
 * search upserts its results here (deduped by source + externalId), powering
 * the Leads dashboard.
 */
export class CreateDiscoveredLeads20260701120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "discovered_leads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "source" character varying(32) NOT NULL,
        "externalId" text NOT NULL,
        "author" character varying(255) NOT NULL,
        "authorDisplay" character varying(255),
        "community" character varying(255),
        "title" text,
        "text" text NOT NULL DEFAULT '',
        "url" text,
        "upvotes" integer,
        "comments" integer,
        "reposts" integer,
        "postedAt" TIMESTAMP,
        "query" character varying(512),
        "status" character varying(16) NOT NULL DEFAULT 'new',
        "convertedUserId" uuid,
        "lastSeenAt" TIMESTAMP,
        CONSTRAINT "PK_discovered_leads" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_discovered_lead" UNIQUE ("source", "externalId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_discovered_leads_source" ON "discovered_leads" ("source")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discovered_leads_status" ON "discovered_leads" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discovered_leads_created" ON "discovered_leads" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "discovered_leads"`);
  }
}
