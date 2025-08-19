import { MigrationInterface, QueryRunner } from 'typeorm';

export class TransactionDataSwap1755620965132 implements MigrationInterface {
  name = 'TransactionDataSwap1755620965132';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
     ALTER TYPE "bets_currency_enum" ADD VALUE IF NOT EXISTS 'gold_coins';

    `);

    await queryRunner.query(`
     ALTER TYPE "bets_currency_enum" ADD VALUE IF NOT EXISTS 'sweep_coins';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "bets_currency_enum_old" AS ENUM ('free_tokens', 'stream_coins', ); 
    `);
    await queryRunner.query(`
      ALTER TABLE "bets" ALTER COLUMN "currency" TYPE "bets_currency_enum_old" USING "currency"::text::"bets_currency_enum_old";
    `);
    await queryRunner.query(`DROP TYPE "bets_currency_enum"`);
    await queryRunner.query(
      `ALTER TYPE "bets_currency_enum_old" RENAME TO "bets_currency_enum"`,
    );
  }
}
