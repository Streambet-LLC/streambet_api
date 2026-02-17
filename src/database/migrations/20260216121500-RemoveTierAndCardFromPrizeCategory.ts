import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTierAndCardFromPrizeCategory20260216121500
  implements MigrationInterface
{
  name = 'RemoveTierAndCardFromPrizeCategory20260216121500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the default
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" ALTER COLUMN "category" DROP DEFAULT`,
    );
    // 2. Update all 'tier' and 'card' values to 'slab'
    await queryRunner.query(
      `UPDATE "prize_configurations" SET "category" = 'slab' WHERE "category" IN ('tier', 'card')`,
    );
    // 2. Remove 'tier' and 'card' from enum
    await queryRunner.query(
      `ALTER TYPE "prize_category_enum" RENAME TO "prize_category_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "prize_category_enum" AS ENUM ('slab', 'sealed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" ALTER COLUMN "category" TYPE "prize_category_enum" USING "category"::text::"prize_category_enum"`,
    );
    await queryRunner.query(`DROP TYPE "prize_category_enum_old"`);
    // 3. Set the new default
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" ALTER COLUMN "category" SET DEFAULT 'slab'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to original enum
    await queryRunner.query(
      `ALTER TYPE "prize_category_enum" RENAME TO "prize_category_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "prize_category_enum" AS ENUM ('tier', 'slab', 'card', 'sealed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" ALTER COLUMN "category" TYPE "prize_category_enum" USING "category"::text::"prize_category_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prize_configurations" ALTER COLUMN "category" SET DEFAULT 'tier'`,
    );
    await queryRunner.query(`DROP TYPE "prize_category_enum_old"`);
  }
}
