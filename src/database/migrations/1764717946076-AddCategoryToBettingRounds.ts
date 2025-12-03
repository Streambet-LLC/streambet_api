import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCategoryToBettingRounds1764717946076 implements MigrationInterface {
    name = 'AddCategoryToBettingRounds1764717946076'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."betting_rounds_category_enum" AS ENUM('trading_cards', 'neosports_alternative', 'sports', 'streaming_competitions', 'other')`);
        await queryRunner.query(`ALTER TABLE "betting_rounds" ADD "category" "public"."betting_rounds_category_enum" DEFAULT 'other'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "betting_rounds" DROP COLUMN "category"`);
        await queryRunner.query(`DROP TYPE "public"."betting_rounds_category_enum"`);
    }

}
