import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirstNameLastNameToUsers1713254400000
  implements MigrationInterface
{
  name = 'AddFirstNameLastNameToUsers1713254400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "first_name" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "last_name" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "first_name"`);
  }
}
