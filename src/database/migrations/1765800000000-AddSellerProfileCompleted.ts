import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `seller_profile_completed` to users to distinguish "the user finished
 * the in-app seller questionnaire" from `seller_onboarding_completed` (which
 * is set only when Stripe Connect reports the account is fully verified).
 *
 * Existing sellers (is_seller = true) are backfilled to `true` so we don't
 * force the questionnaire on legacy accounts.
 */
export class AddSellerProfileCompleted1765800000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'seller_profile_completed',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
    );

    // Backfill: every existing seller already counts as having completed the
    // questionnaire (they went through the legacy admin-approval flow).
    await queryRunner.query(
      `UPDATE "users" SET "seller_profile_completed" = true WHERE "is_seller" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'seller_profile_completed');
  }
}
