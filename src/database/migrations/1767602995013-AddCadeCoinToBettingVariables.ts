import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCadeCoinToBettingVariables1767602995013
  implements MigrationInterface
{
  name = 'AddCadeCoinToBettingVariables1767602995013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "betting_variables" ADD "total_bets_cade_coin_amount" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_variables" ADD "bet_count_cade_coin" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "betting_variables" DROP COLUMN "bet_count_cade_coin"`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_variables" DROP COLUMN "total_bets_cade_coin_amount"`,
    );
  }
}
