import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWithdrawableBalanceToWallets1765526887293 implements MigrationInterface {
    name = 'AddWithdrawableBalanceToWallets1765526887293'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wallets" ADD "withdrawable_balance" decimal(10,2) DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "withdrawable_balance"`);
    }

}
