import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 cleanup: remove the `creator` user role from the running system.
 *
 * - Soft-deletes any pending creator applications (preserves seller apps).
 * - Downgrades any users currently flagged as creators back to regular users.
 * - Leaves the `is_creator` column and the `creator` enum value in place so
 *   the rollback path stays simple; downgrade only flips the data, never
 *   the schema.
 *
 * Picks (formerly bets) and historical wallet ledgers are untouched.
 */
export class RemoveCreatorRole20260506120000 implements MigrationInterface {
  name = 'RemoveCreatorRole20260506120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Soft-delete creator-type applications; sellers are preserved.
    await queryRunner.query(`
      UPDATE creator_applications
      SET is_deleted = true
      WHERE application_type = 'creator'
        AND is_deleted = false
    `);

    // Downgrade any user currently flagged as a creator.
    await queryRunner.query(`
      UPDATE users
      SET role = 'user'
      WHERE role = 'creator'
    `);

    await queryRunner.query(`
      UPDATE users
      SET is_creator = false
      WHERE is_creator = true
    `);

    // Default new applications to seller going forward.
    await queryRunner.query(`
      ALTER TABLE creator_applications
      ALTER COLUMN application_type SET DEFAULT 'seller'
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentional no-op: we cannot reliably restore which users were creators
    // or which applications were creator-type after the soft-delete. The
    // schema itself was not altered destructively.
  }
}
