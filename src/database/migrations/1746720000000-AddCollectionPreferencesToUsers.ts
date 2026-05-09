import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCollectionPreferencesToUsers1746720000000
  implements MigrationInterface
{
  name = 'AddCollectionPreferencesToUsers1746720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "collection_preferences" jsonb DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "collection_preferences"`,
    );
  }
}
