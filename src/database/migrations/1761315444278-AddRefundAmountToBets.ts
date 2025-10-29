import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRefundAmountToBets1761315444278 implements MigrationInterface {
    name = 'AddRefundAmountToBets1761315444278';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "bets" 
            ADD COLUMN "refund_amount" decimal(10,2) DEFAULT 0
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "bets" 
            DROP COLUMN "refund_amount"
        `);
    }

}
