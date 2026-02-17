import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryToPrizeConfigurations20260216120000
  implements MigrationInterface
{
  name = 'AddCategoryToPrizeConfigurations20260216120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "prize_category_enum" AS ENUM ('tier', 'slab', 'card', 'sealed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" ADD "category" "prize_category_enum" NOT NULL DEFAULT 'tier'`,
    );
    // Optionally, update specific prizes here if you want to set categories other than 'tier'
    // Example:
    // await queryRunner.query(`UPDATE "prize_configurations" SET "category" = 'slab' WHERE name ILIKE '%slab%'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" DROP COLUMN "category"`,
    );
    await queryRunner.query(`DROP TYPE "prize_category_enum"`);
  }
}
