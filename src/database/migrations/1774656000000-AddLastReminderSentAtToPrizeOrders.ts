import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLastReminderSentAtToPrizeOrders1774656000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "prize_orders"
            ADD COLUMN IF NOT EXISTS "last_reminder_sent_at" TIMESTAMP;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "prize_orders"
            DROP COLUMN IF EXISTS "last_reminder_sent_at";
        `);
  }
}
