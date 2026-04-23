import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddItemViewsAndWatchers20260423000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cached counters on prize_configurations
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        ADD COLUMN IF NOT EXISTS "view_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "watcher_count" integer NOT NULL DEFAULT 0;
    `);

    // Raw views table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prize_item_views" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "item_id" uuid NOT NULL,
        "user_id" uuid NULL,
        "anon_id" varchar(64) NULL,
        "viewed_on" date NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_prize_item_views_item" FOREIGN KEY ("item_id")
          REFERENCES "prize_configurations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_prize_item_views_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_prize_item_views_viewer" CHECK (
          "user_id" IS NOT NULL OR "anon_id" IS NOT NULL
        )
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_prize_item_views_item" ON "prize_item_views" ("item_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_prize_item_views_user" ON "prize_item_views" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_prize_item_views_anon" ON "prize_item_views" ("anon_id");`,
    );

    // Partial unique indexes enforce 1 row per viewer per day per item.
    // We can't use a single composite UNIQUE (item_id, user_id, anon_id, viewed_on)
    // because NULLs compare as distinct in Postgres.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_prize_item_views_user_day"
        ON "prize_item_views" ("item_id", "user_id", "viewed_on")
        WHERE "user_id" IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_prize_item_views_anon_day"
        ON "prize_item_views" ("item_id", "anon_id", "viewed_on")
        WHERE "user_id" IS NULL AND "anon_id" IS NOT NULL;
    `);

    // Watchers table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prize_item_watchers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "item_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_prize_item_watchers_item_user" UNIQUE ("item_id", "user_id"),
        CONSTRAINT "FK_prize_item_watchers_item" FOREIGN KEY ("item_id")
          REFERENCES "prize_configurations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_prize_item_watchers_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_prize_item_watchers_user" ON "prize_item_watchers" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_prize_item_watchers_item" ON "prize_item_watchers" ("item_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_item_watchers_item";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_item_watchers_user";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "prize_item_watchers";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_prize_item_views_anon_day";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_prize_item_views_user_day";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_item_views_anon";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_item_views_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prize_item_views_item";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "prize_item_views";`);

    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        DROP COLUMN IF EXISTS "watcher_count",
        DROP COLUMN IF EXISTS "view_count";
    `);
  }
}
