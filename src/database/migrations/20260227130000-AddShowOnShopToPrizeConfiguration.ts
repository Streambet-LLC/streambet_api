import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShowOnShopToPrizeConfiguration20260227130000
  implements MigrationInterface
{
  name = 'AddShowOnShopToPrizeConfiguration20260227130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" ADD "show_on_shop" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" DROP COLUMN "show_on_shop"`,
    );
  }
}
