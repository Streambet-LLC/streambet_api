import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateAllUsersFeeToFour20260323000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Catch any users still at 7% (e.g. users who weren't sellers yet when the first migration ran)
    await queryRunner.query(`
      UPDATE "users"
      SET "application_fee_percent" = 4
      WHERE "application_fee_percent" = 7
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cannot reliably revert since we don't know who was originally 7%
  }
}
