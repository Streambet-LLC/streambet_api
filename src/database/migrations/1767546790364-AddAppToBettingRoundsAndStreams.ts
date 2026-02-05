import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppToBettingRoundsAndStreams1767546790364
  implements MigrationInterface
{
  name = 'AddAppToBettingRoundsAndStreams1767546790364';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ADD "app" character varying NOT NULL DEFAULT 'pro'`,
    );
    await queryRunner.query(
      `ALTER TABLE "streams" ADD "app" character varying NOT NULL DEFAULT 'pro'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "streams" DROP COLUMN "app"`);
    await queryRunner.query(`ALTER TABLE "betting_rounds" DROP COLUMN "app"`);
  }
}
