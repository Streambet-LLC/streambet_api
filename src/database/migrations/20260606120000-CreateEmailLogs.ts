import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Audit log of every transactional email send attempt, so admins can see what
 * went out per order and resend when needed. Written by EmailsService.
 */
export class CreateEmailLogs20260606120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "email_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email_type" varchar(64) NOT NULL,
        "to_address" text NOT NULL,
        "subject" text,
        "params" jsonb,
        "related_order_id" uuid,
        "status" varchar(16) NOT NULL,
        "error" text,
        "message_id" varchar(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_email_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_logs_related_order_id" ON "email_logs" ("related_order_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_email_logs_related_order_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "email_logs"`);
  }
}
