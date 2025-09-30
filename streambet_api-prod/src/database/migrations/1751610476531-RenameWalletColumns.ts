import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameWalletColumns1751610476531 implements MigrationInterface {
  name = 'RenameWalletColumns1751610476531';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename freeTokens -> gold_coin
    await queryRunner.query(`
      ALTER TABLE "wallets"
      RENAME COLUMN "freeTokens" TO "gold_coins"
    `);

    // Rename streamCoin -> sweep_coin
    await queryRunner.query(`
      ALTER TABLE "wallets"
      RENAME COLUMN "streamCoins" TO "sweep_coins"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback sweep_coin -> streamCoin
    await queryRunner.query(`
      ALTER TABLE "wallets"
      RENAME COLUMN "sweep_coins" TO "streamCoins"
    `);

    // Rollback gold_coin -> freeTokens
    await queryRunner.query(`
      ALTER TABLE "wallets"
      RENAME COLUMN "gold_coins" TO "freeTokens"
    `);
  }
}
