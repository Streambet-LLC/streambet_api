import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a free-form `analytics_profile` jsonb column to the `users` table.
 *
 * Used by the admin Collector Analytics surface to store admin-injected
 * profile annotations (notes, tags, persona override, interests, etc.) that
 * the future AI integration will consume. Kept loose / unstructured on
 * purpose — the DTO layer enforces the shape we currently care about.
 */
export class AddAnalyticsProfileToUsers20260527120000
  implements MigrationInterface
{
  name = 'AddAnalyticsProfileToUsers20260527120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "analytics_profile" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "analytics_profile"`,
    );
  }
}
