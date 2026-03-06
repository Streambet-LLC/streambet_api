import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStripeProductIdToPrizes1772809366735 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "prize_configurations"
            ADD COLUMN IF NOT EXISTS "stripe_product_id" VARCHAR(100);
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "prize_configurations" 
            DROP COLUMN IF EXISTS "stripe_product_id"
        `);
    }

}
