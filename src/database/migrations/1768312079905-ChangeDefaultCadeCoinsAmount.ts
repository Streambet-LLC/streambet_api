import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeDefaultCadeCoinsAmount1768312079905 implements MigrationInterface {
    name = 'ChangeDefaultCadeCoinsAmount1768312079905'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wallets" ALTER COLUMN "cade_coins" SET DEFAULT '100'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wallets" ALTER COLUMN "cade_coins" SET DEFAULT '1000'`);
    }

}
