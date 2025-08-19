import { MigrationInterface, QueryRunner } from 'typeorm';

export class TransactionDataSwap1755620965132 implements MigrationInterface {
  name = 'TransactionDataSwap1755620965132';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE bets
      SET currency = 'gold_coins'
      WHERE currency = 'free_tokens'
    `);

    await queryRunner.query(`
      UPDATE bets
      SET currency = 'sweep_coins'
      WHERE currency = 'stream_coins'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // revert the changes if you rollback
    await queryRunner.query(`
      UPDATE bets
      SET currency = 'free_tokens'
      WHERE currency = 'gold_coins'
      AND id IN (
        SELECT id FROM bets WHERE currency = 'gold_coins'
      )
    `);

    await queryRunner.query(`
      UPDATE bets
      SET currency = 'stream_coins'
      WHERE currency = 'sweep_coins'
      AND id IN (
        SELECT id FROM bets WHERE currency = 'sweep_coins'
      )
    `);
  }
}
