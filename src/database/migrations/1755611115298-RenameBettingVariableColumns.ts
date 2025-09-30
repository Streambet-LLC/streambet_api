import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameBettingVariableColumn1755611115298 implements MigrationInterface {
  name = 'RenameBettingVariableColumn1755611115298';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename totalBetsTokenAmount -> total_bets_gold_coin_amount
    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      RENAME COLUMN "totalBetsTokenAmount" TO "total_bets_gold_coin_amount"
    `);

    // Rename totalBetsCoinAmount -> total_bets_sweep_coin_amount
    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      RENAME COLUMN "totalBetsCoinAmount" TO "total_bets_sweep_coin_amount"
    `);
    // Rename betCountFreeToken -> bet_count_gold_coin
    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      RENAME COLUMN "betCountFreeToken" TO "bet_count_gold_coin"
    `);
    // Rename betCountCoin -> bet_count_sweep_coin
    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      RENAME COLUMN "betCountCoin" TO "bet_count_sweep_coin"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback total_bets_gold_coin_amount -> totalBetsTokenAmount
    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      RENAME COLUMN "total_bets_gold_coin_amount" TO "totalBetsTokenAmount"
    `);

    // Rollback total_bets_sweep_coin_amount -> totalBetsCoinAmount
    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      RENAME COLUMN "total_bets_sweep_coin_amount" TO "totalBetsCoinAmount"
    `);

    // Rename bet_count_gold_coin -> betCountFreeToken
    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      RENAME COLUMN "bet_count_gold_coin" TO "betCountFreeToken"
    `);
    // Rename bet_count_sweep_coin -> betCountCoin
    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      RENAME COLUMN "bet_count_sweep_coin" TO "betCountCoin"
    `);
  }
}
