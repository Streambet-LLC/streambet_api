import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill migration to recompute bet_count_cade_coin for sentiment picks.
 * This fixes sentiment picks that had votes before the fix was applied.
 *
 * The issue was that sentiment pick votes were not being counted in bet_count_cade_coin,
 * so the percentage calculations showed 0% even when users had voted.
 *
 * This migration counts all active bets with currency = 'cade_coins' for each
 * betting variable in sentiment picks and updates the bet_count_cade_coin accordingly.
 */
export class BackfillSentimentPickBetCounts1739500000000
  implements MigrationInterface
{
  name = 'BackfillSentimentPickBetCounts1739500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update bet_count_cade_coin for all betting variables in sentiment picks
    // based on the actual count of active cade_coin bets
    await queryRunner.query(`
      UPDATE betting_variables bv
      SET bet_count_cade_coin = (
        SELECT COUNT(*)
        FROM bets b
        WHERE b.betting_variable_id = bv.id
        AND b.currency = 'cade_coins'
        AND b.status = 'active'
      )
      WHERE bv.round_id IN (
        SELECT id
        FROM betting_rounds br
        WHERE br.mechanism = 'sentiment'
      )
    `);

    console.log(
      '✓ Backfilled bet_count_cade_coin for sentiment pick betting variables',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This is a data backfill migration - down should reset to 0
    // since we can't know the original values
    await queryRunner.query(`
      UPDATE betting_variables bv
      SET bet_count_cade_coin = 0
      WHERE bv.round_id IN (
        SELECT id
        FROM betting_rounds br
        WHERE br.mechanism = 'sentiment'
      )
    `);

    console.log(
      '✓ Reset bet_count_cade_coin for sentiment pick betting variables',
    );
  }
}
