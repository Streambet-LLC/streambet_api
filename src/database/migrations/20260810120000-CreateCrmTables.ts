import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CRM manual layer — buyer/seller contacts and their note timelines, sitting on
 * top of the auto-discovered leads pool. Contacts can be created by hand or by
 * converting a discovered lead; notes attach to either a contact or a lead.
 */
export class CreateCrmTables20260810120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_contacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "kind" character varying(16) NOT NULL,
        "name" character varying(200) NOT NULL,
        "handle" character varying(200),
        "email" character varying(200),
        "company" character varying(200),
        "location" character varying(200),
        "source" character varying(32) NOT NULL DEFAULT 'manual',
        "stage" character varying(24) NOT NULL DEFAULT 'new',
        "preferred" boolean NOT NULL DEFAULT false,
        "tags" jsonb,
        "interests" jsonb,
        "leadId" uuid,
        "createdById" uuid,
        CONSTRAINT "PK_crm_contacts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crm_contacts_kind" ON "crm_contacts" ("kind")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crm_contacts_stage" ON "crm_contacts" ("stage")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crm_contacts_preferred" ON "crm_contacts" ("preferred")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "contactId" uuid,
        "leadId" uuid,
        "body" text NOT NULL,
        "authorId" uuid,
        CONSTRAINT "PK_crm_notes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crm_notes_contactId" ON "crm_notes" ("contactId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crm_notes_leadId" ON "crm_notes" ("leadId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_notes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_contacts"`);
  }
}
