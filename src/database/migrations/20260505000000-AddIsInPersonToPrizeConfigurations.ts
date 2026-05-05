import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `prize_configurations.is_in_person` so sellers can mark an item as
 * an in-person pickup (no shipping required). When true, the checkout
 * flow skips the shipping address requirement and the displayed
 * shipping cost defaults to $0.00 (sellers can still override). Existing
 * rows default to false (i.e. ship-as-normal) to preserve current
 * behavior for every legacy listing.
 */
export class AddIsInPersonToPrizeConfigurations20260505000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        ADD COLUMN IF NOT EXISTS "is_in_person" boolean
          NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
        DROP COLUMN IF EXISTS "is_in_person";
    `);
  }
}
