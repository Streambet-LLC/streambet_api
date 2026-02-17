import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrizeOfferFieldsSimple1771299200000
  implements MigrationInterface
{
  name = 'AddPrizeOfferFieldsSimple1771299200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add offer-related columns to prize_orders
    await queryRunner.query(`
      ALTER TABLE "prize_orders" 
      ADD COLUMN IF NOT EXISTS "offer_amount" numeric(10,2),
      ADD COLUMN IF NOT EXISTS "counter_offer_amount" numeric(10,2),
      ADD COLUMN IF NOT EXISTS "offer_notes" text
    `);

    // The status column is VARCHAR, so no enum changes needed
    // The TypeORM entity will handle validation of allowed values
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove offer-related columns
    await queryRunner.query(`
      ALTER TABLE "prize_orders" 
      DROP COLUMN IF EXISTS "offer_amount",
      DROP COLUMN IF EXISTS "counter_offer_amount",
      DROP COLUMN IF EXISTS "offer_notes"
    `);
  }
}
