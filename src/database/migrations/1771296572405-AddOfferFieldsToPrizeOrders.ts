import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferFieldsToPrizeOrders1771296572405
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add offer fields to prize_orders table
    await queryRunner.query(`
            ALTER TABLE "prize_orders" 
            ADD COLUMN "offerAmount" NUMERIC(10,2),
            ADD COLUMN "counterOfferAmount" NUMERIC(10,2),
            ADD COLUMN "offerNotes" TEXT
        `);

    // Update status enum to include offer statuses
    await queryRunner.query(`
            ALTER TABLE "prize_orders" 
            ALTER COLUMN "status" TYPE VARCHAR(50)
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert status column type
    await queryRunner.query(`
            ALTER TABLE "prize_orders" 
            ALTER COLUMN "status" TYPE VARCHAR(20)
        `);

    // Remove offer fields
    await queryRunner.query(`
            ALTER TABLE "prize_orders" 
            DROP COLUMN "offerNotes",
            DROP COLUMN "counterOfferAmount",
            DROP COLUMN "offerAmount"
        `);
  }
}
