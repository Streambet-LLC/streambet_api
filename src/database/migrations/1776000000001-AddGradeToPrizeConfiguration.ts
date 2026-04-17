import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGradeToPrizeConfiguration1776000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      ADD COLUMN "grade" varchar(10) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prize_configurations"
      DROP COLUMN "grade"
    `);
  }
}
