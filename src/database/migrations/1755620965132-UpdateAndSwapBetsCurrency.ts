import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateAndSwapBetsCurrency1755620965132 implements MigrationInterface {
  name = 'UpdateAndSwapBetsCurrency1755620965132';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ✅ Step 2: Update existing data to new values
    await queryRunner.query(`
      UPDATE "bets"
      SET "currency" = 'gold_coins'
      WHERE "currency" = 'free_tokens';
    `);

    await queryRunner.query(`
      UPDATE "bets"
      SET "currency" = 'sweep_coins'
      WHERE "currency" = 'stream_coins';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ✅ Step 1: Backfill to old values
    await queryRunner.query(`
      UPDATE "bets"
      SET "currency" = 'free_tokens'
      WHERE "currency" = 'gold_coins';
    `);

    await queryRunner.query(`
      UPDATE "bets"
      SET "currency" = 'stream_coins'
      WHERE "currency" = 'sweep_coins';
    `);

    // ✅ Step 2: Create a temp enum with old values only
    await queryRunner.query(`
      CREATE TYPE "bets_currency_enum_old" AS ENUM ('free_tokens', 'stream_coins'); 
    `);

    await queryRunner.query(`
      ALTER TABLE "bets" 
      ALTER COLUMN "currency" TYPE "bets_currency_enum_old" 
      USING "currency"::text::"bets_currency_enum_old";
    `);

    // ✅ Step 3: Drop new enum and rename old one back
    await queryRunner.query(`DROP TYPE "bets_currency_enum";`);
    await queryRunner.query(`
      ALTER TYPE "bets_currency_enum_old" RENAME TO "bets_currency_enum";
    `);
  }
}
