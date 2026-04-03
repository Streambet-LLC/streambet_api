import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandProfileImageUrlColumn1743717200000
  implements MigrationInterface
{
  name = 'ExpandProfileImageUrlColumn1743717200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "profile_image_url" TYPE varchar(2048)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "profile_image_url" TYPE varchar(255)
    `);
  }
}
