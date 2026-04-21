import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewsTable20260420000100 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "reviewer_id" uuid NOT NULL,
        "reviewee_id" uuid NOT NULL,
        "reviewer_role" varchar(10) NOT NULL,
        "rating" integer NOT NULL,
        "comment" text NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_reviews_rating_range" CHECK ("rating" >= 1 AND "rating" <= 5),
        CONSTRAINT "UQ_reviews_order_reviewer" UNIQUE ("order_id", "reviewer_id"),
        CONSTRAINT "FK_reviews_order" FOREIGN KEY ("order_id")
          REFERENCES "prize_orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reviews_reviewer" FOREIGN KEY ("reviewer_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reviews_reviewee" FOREIGN KEY ("reviewee_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_reviews_reviewee" ON "reviews" ("reviewee_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_reviews_reviewer" ON "reviews" ("reviewer_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_reviews_order" ON "reviews" ("order_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reviews_order";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reviews_reviewer";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reviews_reviewee";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reviews";`);
  }
}
