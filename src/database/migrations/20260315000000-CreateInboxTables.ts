import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInboxTables20260315000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create conversation_type enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "conversation_type_enum" AS ENUM ('direct', 'support');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    // 2. Create conversations table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "type" "conversation_type_enum" NOT NULL DEFAULT 'direct',
        "subject" varchar(255),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // 3. Create conversation_participants table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation_participants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "last_read_at" TIMESTAMP,
        "is_blocked" boolean NOT NULL DEFAULT false,
        "blocked_at" TIMESTAMP,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_cp_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_cp_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE NO ACTION
      )
    `);

    // 4. Create messages table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "sender_id" uuid NOT NULL,
        "content" text NOT NULL,
        "is_admin_message" boolean NOT NULL DEFAULT false,
        "admin_name" varchar(255),
        "has_read_receipt" boolean NOT NULL DEFAULT false,
        "read_at" TIMESTAMP,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_msg_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_msg_sender" FOREIGN KEY ("sender_id")
          REFERENCES "users"("id") ON DELETE NO ACTION
      )
    `);

    // 5. Create message_attachments table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_attachments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "message_id" uuid NOT NULL,
        "file_url" varchar(1000) NOT NULL,
        "file_name" varchar(255) NOT NULL,
        "mime_type" varchar(100) NOT NULL,
        "file_size" integer NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_ma_message" FOREIGN KEY ("message_id")
          REFERENCES "messages"("id") ON DELETE CASCADE
      )
    `);

    // 6. Create user_blocks table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_blocks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "blocker_id" uuid NOT NULL,
        "blocked_id" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_ub_blocker" FOREIGN KEY ("blocker_id")
          REFERENCES "users"("id") ON DELETE NO ACTION,
        CONSTRAINT "fk_ub_blocked" FOREIGN KEY ("blocked_id")
          REFERENCES "users"("id") ON DELETE NO ACTION,
        CONSTRAINT "uq_user_blocks_pair" UNIQUE ("blocker_id", "blocked_id")
      )
    `);

    // 7. Add read_receipts_enabled column to users table
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "read_receipts_enabled" boolean NOT NULL DEFAULT true
    `);

    // 8. Create indexes for performance
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_cp_conversation_id" ON "conversation_participants" ("conversation_id");
      CREATE INDEX IF NOT EXISTS "idx_cp_user_id" ON "conversation_participants" ("user_id");
      CREATE INDEX IF NOT EXISTS "idx_msg_conversation_id" ON "messages" ("conversation_id");
      CREATE INDEX IF NOT EXISTS "idx_msg_sender_id" ON "messages" ("sender_id");
      CREATE INDEX IF NOT EXISTS "idx_msg_created_at" ON "messages" ("createdAt");
      CREATE INDEX IF NOT EXISTS "idx_ma_message_id" ON "message_attachments" ("message_id");
      CREATE INDEX IF NOT EXISTS "idx_ub_blocker_id" ON "user_blocks" ("blocker_id");
      CREATE INDEX IF NOT EXISTS "idx_ub_blocked_id" ON "user_blocks" ("blocked_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_ub_blocked_id";
      DROP INDEX IF EXISTS "idx_ub_blocker_id";
      DROP INDEX IF EXISTS "idx_ma_message_id";
      DROP INDEX IF EXISTS "idx_msg_created_at";
      DROP INDEX IF EXISTS "idx_msg_sender_id";
      DROP INDEX IF EXISTS "idx_msg_conversation_id";
      DROP INDEX IF EXISTS "idx_cp_user_id";
      DROP INDEX IF EXISTS "idx_cp_conversation_id";
    `);

    // Remove column from users
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "read_receipts_enabled"
    `);

    // Drop tables in reverse order (respecting FK dependencies)
    await queryRunner.query(`DROP TABLE IF EXISTS "user_blocks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "message_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_participants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversations"`);

    // Drop enum type
    await queryRunner.query(`DROP TYPE IF EXISTS "conversation_type_enum"`);
  }
}
