import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReviewReminderSentAtToPrizeOrders20260420000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_orders"
      ADD COLUMN IF NOT EXISTS "review_reminder_sent_at" TIMESTAMP;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_orders"
      DROP COLUMN IF EXISTS "review_reminder_sent_at";
    `);
  }
}
