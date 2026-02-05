import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCadeCoins1767546357991 implements MigrationInterface {
  name = 'AddCadeCoins1767546357991';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD "cade_coins" numeric NOT NULL DEFAULT '1000'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_currencytype_enum" RENAME TO "transactions_currencytype_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_currencytype_enum" AS ENUM('free_tokens', 'stream_coins', 'sweep_coins', 'gold_coins', 'cade_coins')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "currencyType" TYPE "public"."transactions_currencytype_enum" USING "currencyType"::"text"::"public"."transactions_currencytype_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."transactions_currencytype_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."bets_currency_enum" RENAME TO "bets_currency_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."bets_currency_enum" AS ENUM('free_tokens', 'stream_coins', 'sweep_coins', 'gold_coins', 'cade_coins')`,
    );
    await queryRunner.query(
      `ALTER TABLE "bets" ALTER COLUMN "currency" TYPE "public"."bets_currency_enum" USING "currency"::"text"::"public"."bets_currency_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."bets_currency_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "cade_coins"`);
    await queryRunner.query(
      `CREATE TYPE "public"."bets_currency_enum_old" AS ENUM('free_tokens', 'stream_coins', 'gold_coins', 'sweep_coins')`,
    );
    await queryRunner.query(
      `ALTER TABLE "bets" ALTER COLUMN "currency" TYPE "public"."bets_currency_enum_old" USING "currency"::"text"::"public"."bets_currency_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."bets_currency_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."bets_currency_enum_old" RENAME TO "bets_currency_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_currencytype_enum_old" AS ENUM('free_tokens', 'stream_coins', 'gold_coins', 'sweep_coins')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "currencyType" TYPE "public"."transactions_currencytype_enum_old" USING "currencyType"::"text"::"public"."transactions_currencytype_enum_old"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."transactions_currencytype_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_currencytype_enum_old" RENAME TO "transactions_currencytype_enum"`,
    );
  }
}
