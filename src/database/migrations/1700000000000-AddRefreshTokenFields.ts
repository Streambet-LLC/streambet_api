import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenFields1700000000000 implements MigrationInterface {
  name = 'AddRefreshTokenFields1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN "refreshToken" TEXT,
      ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" 
      DROP COLUMN "refreshToken",
      DROP COLUMN "refreshTokenExpiresAt"
    `);
  }
}
