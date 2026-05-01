import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Intentionally a no-op.
 *
 * The original intent was to bulk-reassign admin-owned prize_configurations
 * to `created_by = NULL` (CardCade ownership). In practice, several admin
 * accounts also act as sellers, so the role-based filter scooped up
 * legitimate seller items and dumped them into the CardCade shop. The
 * stage database was already corrected by hand and we do NOT want this
 * to run anywhere else.
 *
 * Going forward, the admin "Sell as CardCade" toggle in the prize editor
 * is the supported way to (re)assign an item to CardCade. Bulk backfill,
 * if ever needed again, must be done with an explicit per-item allowlist
 * in a fresh migration — never a role-wide UPDATE.
 *
 * The class is kept (not deleted) so any environment that previously
 * recorded it as run continues to validate; the body is empty so any
 * environment that hasn't run it yet (e.g. prod) records the row without
 * mutating data.
 */
export class BackfillAdminPrizeConfigsToCardcade20260503000000
  implements MigrationInterface
{
  name = 'BackfillAdminPrizeConfigsToCardcade20260503000000';

  public up(_queryRunner: QueryRunner): Promise<void> {
    // No-op. See class doc above for why.
    return Promise.resolve();
  }

  public down(_queryRunner: QueryRunner): Promise<void> {
    // No-op.
    return Promise.resolve();
  }
}
