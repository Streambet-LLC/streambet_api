import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShopNameToUsers1741101600000 implements MigrationInterface {
  name = 'AddShopNameToUsers1741101600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "shop_name" character varying(255) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "shop_name"`);
  }
}
