import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBetEditHistoryTable1770227667000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for edit_type
    await queryRunner.query(`
            CREATE TYPE "public"."bet_edit_type_enum" AS ENUM('amount_change', 'option_change', 'full_change')
        `);

    // Create bet_edit_history table
    // Note: CASCADE DELETE is intentional for chart visualization use case.
    // Edit history is only needed while parent entities exist for real-time charts.
    // If audit trail preservation is needed in future, migrate to soft deletes.
    await queryRunner.query(`
            CREATE TABLE "bet_edit_history" (
                "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                "bet_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "round_id" uuid NOT NULL,
                "stream_id" uuid NOT NULL,
                "old_betting_variable_id" uuid NOT NULL,
                "new_betting_variable_id" uuid NOT NULL,
                "old_amount" bigint NOT NULL,
                "new_amount" bigint NOT NULL,
                "currency" varchar NOT NULL CHECK (currency = 'cade_coins'),
                "edit_type" "public"."bet_edit_type_enum" NOT NULL,
                "edited_at" TIMESTAMP NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "fk_bet_edit_history_bet" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_bet_edit_history_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_bet_edit_history_round" FOREIGN KEY ("round_id") REFERENCES "betting_rounds"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_bet_edit_history_stream" FOREIGN KEY ("stream_id") REFERENCES "streams"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_bet_edit_history_old_variable" FOREIGN KEY ("old_betting_variable_id") REFERENCES "betting_variables"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_bet_edit_history_new_variable" FOREIGN KEY ("new_betting_variable_id") REFERENCES "betting_variables"("id") ON DELETE CASCADE
            )
        `);

    // Create index on bet_id for quick lookups by bet
    await queryRunner.query(`
            CREATE INDEX "idx_bet_edit_history_bet_id" 
            ON "bet_edit_history" ("bet_id")
        `);

    // Create index on stream_id for stream-level queries
    await queryRunner.query(`
            CREATE INDEX "idx_bet_edit_history_stream_id" 
            ON "bet_edit_history" ("stream_id")
        `);

    // Create index on edited_at for time-based queries
    await queryRunner.query(`
            CREATE INDEX "idx_bet_edit_history_edited_at" 
            ON "bet_edit_history" ("edited_at")
        `);

    // Create composite index on (round_id, edited_at) for efficient timeline queries
    await queryRunner.query(`
            CREATE INDEX "idx_bet_edit_history_round_edited" 
            ON "bet_edit_history" ("round_id", "edited_at")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_bet_edit_history_round_edited"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_bet_edit_history_edited_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_bet_edit_history_stream_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_bet_edit_history_bet_id"`,
    );

    // Drop table (foreign key constraints will be dropped automatically)
    await queryRunner.query(`DROP TABLE IF EXISTS "bet_edit_history"`);

    // Drop enum type
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."bet_edit_type_enum"`,
    );
  }
}
