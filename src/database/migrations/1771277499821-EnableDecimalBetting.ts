import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnableDecimalBetting1771277499821 implements MigrationInterface {
  name = 'EnableDecimalBetting1771277499821';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable decimal precision for betting amounts and payouts
    await queryRunner.query(`
      ALTER TABLE "bets"
      ALTER COLUMN "amount" TYPE decimal(12,3)
      USING "amount"::decimal(12,3)
    `);

    await queryRunner.query(`
      ALTER TABLE "bets"
      ALTER COLUMN "payout" TYPE decimal(12,3)
      USING "payout"::decimal(12,3)
    `);

    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      ALTER COLUMN "total_bets_cade_coin_amount" TYPE decimal(15,3)
      USING "total_bets_cade_coin_amount"::decimal(15,3)
    `);

    await queryRunner.query(`
      ALTER TABLE "live_feed_updates"
      ALTER COLUMN "amount" TYPE decimal(12,3)
      USING "amount"::decimal(12,3)
    `);

    await queryRunner.query(`
      ALTER TABLE "bet_edit_history"
      ALTER COLUMN "old_amount" TYPE decimal(12,3)
      USING "old_amount"::decimal(12,3)
    `);

    await queryRunner.query(`
      ALTER TABLE "bet_edit_history"
      ALTER COLUMN "new_amount" TYPE decimal(12,3)
      USING "new_amount"::decimal(12,3)
    `);

    await queryRunner.query(`
      ALTER TABLE "wallets"
      ALTER COLUMN "cade_coins" TYPE decimal(12,3)
      USING "cade_coins"::decimal(12,3)
    `);
  }

  /**
   * WARNING: ROLLBACK CAUSES PERMANENT DATA LOSS
   *
   * Converts decimal to integer/bigint using round(), destroying fractional precision.
   * Examples: 100.750 -> 101 | 100.250 -> 100 | 99.999 -> 100
   *
   * Affected: bets, betting_variables, live_feed_updates, bet_edit_history, wallets
   * ACTION: Backup tables before rollback (pg_dump or snapshot)
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bets"
      ALTER COLUMN "amount" TYPE bigint
      USING round("amount")::bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "bets"
      ALTER COLUMN "payout" TYPE bigint
      USING round("payout")::bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "betting_variables"
      ALTER COLUMN "total_bets_cade_coin_amount" TYPE bigint
      USING round("total_bets_cade_coin_amount")::bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "live_feed_updates"
      ALTER COLUMN "amount" TYPE integer
      USING round("amount")::integer
    `);

    await queryRunner.query(`
      ALTER TABLE "bet_edit_history"
      ALTER COLUMN "old_amount" TYPE bigint
      USING round("old_amount")::bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "bet_edit_history"
      ALTER COLUMN "new_amount" TYPE bigint
      USING round("new_amount")::bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "wallets"
      ALTER COLUMN "cade_coins" TYPE numeric
      USING "cade_coins"::numeric
    `);
  }
}
