import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

export class AdminCredentialsMigration1621500000000
  implements MigrationInterface
{
  name = 'AdminCredentialsMigration1621500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash('asd@123A', salt);

    await queryRunner.query(`
      INSERT INTO users (
        id,
        username,
        email,
        password,
        role,
        "is_active",
        "is_verify",
        "tos_accepted",
        "tos_accepted_at",
        "account_creation_date",
        "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'streambetadmin',
        'admin@streambet.com',
        '${hashedPassword}',
        'admin',
        true,
        true,
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the admin user
    await queryRunner.query(`
      DELETE FROM users 
      WHERE email = 'admin@streambet.com' 
      AND username = 'streambetadmin'
    `);
  }
}
