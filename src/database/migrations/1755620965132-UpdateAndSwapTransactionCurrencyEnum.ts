import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateAndSwapTransactionCurrencyEnum1755620965132
  implements MigrationInterface
{
  name = 'UpdateAndSwapTransactionCurrencyEnum1755620965132';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 2. Update existing rows to new values
    await queryRunner.query(`
      UPDATE "transactions"
      SET "currencyType" = 'gold_coins'
      WHERE "currencyType" = 'free_tokens';
    `);

    await queryRunner.query(`
      UPDATE "transactions"
      SET "currencyType" = 'sweep_coins'
      WHERE "currencyType" = 'stream_coins';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Backfill new enum values back to old ones
    await queryRunner.query(`
      UPDATE "transactions"
      SET "currencyType" = 'free_tokens'
      WHERE "currencyType" = 'gold_coins';
    `);
    await queryRunner.query(`
      UPDATE "transactions"
      SET "currencyType" = 'stream_coins'
      WHERE "currencyType" = 'sweep_coins';
    `);

    // 2. Create a temporary old enum type
    await queryRunner.query(`
      CREATE TYPE "transactions_currencytype_enum_old" AS ENUM ('free_tokens', 'stream_coins');
    `);

    // 3. Recast the column to use the old enum
    await queryRunner.query(`
      ALTER TABLE "transactions"
      ALTER COLUMN "currencyType"
      TYPE "transactions_currencytype_enum_old"
      USING "currencyType"::text::"transactions_currencytype_enum_old";
    `);

    // 4. Drop the new enum
    await queryRunner.query(`DROP TYPE "transactions_currencytype_enum"`);
  }
}
