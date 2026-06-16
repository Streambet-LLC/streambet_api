import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Allow admin-created "shadow"/prospect collector profiles (the Analytics
 * surface) to have NO username/email, so a real person can be tied to that
 * pre-entered persona data when they later sign up. A fake auto-generated
 * email would also wrongly occupy the unique-email slot and block that future
 * signup — leaving it null avoids that.
 *
 * Postgres unique indexes permit multiple NULLs, so uniqueness for real
 * accounts (non-null username/email) is unaffected.
 */
export class MakeUserCredentialsNullable20260615120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "username" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-adding NOT NULL fails if any null rows exist (admin shadow profiles);
    // those would need to be backfilled or removed first.
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL`,
    );
  }
}
