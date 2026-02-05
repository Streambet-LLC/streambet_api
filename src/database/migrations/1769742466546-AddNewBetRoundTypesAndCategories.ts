import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNewBetRoundTypesAndCategories1769742466546
  implements MigrationInterface
{
  name = 'AddNewBetRoundTypesAndCategories1769742466546';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."betting_rounds_type_enum" AS ENUM('auction', 'future', 'opinion', 'pick')`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ADD "type" "public"."betting_rounds_type_enum" NOT NULL DEFAULT 'pick'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."betting_rounds_category_enum" RENAME TO "betting_rounds_category_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."betting_rounds_category_enum" AS ENUM('trading_cards', 'neosports_alternative', 'sports', 'streaming_competitions', 'emerging_sports', 'pokemon_cards', 'sports_cards', 'other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ALTER COLUMN "category" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ALTER COLUMN "category" TYPE "public"."betting_rounds_category_enum" USING "category"::"text"::"public"."betting_rounds_category_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ALTER COLUMN "category" SET DEFAULT 'other'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."betting_rounds_category_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ALTER COLUMN "category" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ALTER COLUMN "category" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."betting_rounds_category_enum_old" AS ENUM('trading_cards', 'neosports_alternative', 'sports', 'streaming_competitions', 'emerging_sports', 'other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ALTER COLUMN "category" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ALTER COLUMN "category" TYPE "public"."betting_rounds_category_enum_old" USING "category"::"text"::"public"."betting_rounds_category_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "betting_rounds" ALTER COLUMN "category" SET DEFAULT 'other'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."betting_rounds_category_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."betting_rounds_category_enum_old" RENAME TO "betting_rounds_category_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."betting_rounds_type_enum"`);
  }
}
