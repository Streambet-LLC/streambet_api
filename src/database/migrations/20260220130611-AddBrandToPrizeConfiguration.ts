import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBrandToPrizeConfiguration1771621414821
  implements MigrationInterface
{
  name = 'AddBrandToPrizeConfiguration1771621414821';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."prize_configurations_brand_enum" AS ENUM('pokemon', 'one_piece', 'sports')`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" ADD "brand" "public"."prize_configurations_brand_enum" NOT NULL DEFAULT 'pokemon'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" DROP COLUMN "brand"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."prize_configurations_brand_enum"`,
    );
  }
}
