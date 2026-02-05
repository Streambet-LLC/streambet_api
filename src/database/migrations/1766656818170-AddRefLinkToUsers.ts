import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefLinkToUsers1766656818170 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "users" 
            ADD COLUMN "ref_link" varchar(255) NULL
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "users" 
            DROP COLUMN "ref_link"
        `);
  }
}
