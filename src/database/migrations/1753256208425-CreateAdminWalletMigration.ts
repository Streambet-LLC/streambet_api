import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminWalletMigration1753256208425
  implements MigrationInterface
{
  name = 'CreateAdminWalletMigration1753256208425';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const result = await queryRunner.query(`
      SELECT id FROM users 
      WHERE email = 'admin@streambet.com' 
      AND username = 'streambetadmin'
    `);

    if (!result || result.length === 0) {
      throw new Error(
        'Admin user not found. Please run the admin user migration first.',
      );
    }

    const adminId = result[0].id;

    await queryRunner.query(
      `
      INSERT INTO wallets (
        id,
        "userId",
        "gold_coins",
        "sweep_coins",
       "autoReloadEnabled",
        "autoReloadAmount",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        gen_random_uuid(),
        $1,
        1000,
        0,
       false,
        NULL,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
      [adminId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM wallets
      WHERE "userId" = (
        SELECT id FROM users
        WHERE email = 'admin@streambet.com'
        AND username = 'streambetadmin'
      )
    `);
  }
}
