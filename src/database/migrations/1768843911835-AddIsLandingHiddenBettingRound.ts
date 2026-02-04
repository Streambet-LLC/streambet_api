import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsLandingHiddenBettingRound1768843911835
  implements MigrationInterface
{
  name = 'AddIsLandingHiddenBettingRound1768843911835';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ADD "is_landing_hidden" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" DROP COLUMN "is_landing_hidden"`,
    );
  }
}
