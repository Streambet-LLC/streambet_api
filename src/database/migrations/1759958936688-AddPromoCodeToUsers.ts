import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPromoCodeToUsers1759958936688 implements MigrationInterface {
    name = 'AddPromoCodeToUsers1759958936688';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add promo_code column to users table
        await queryRunner.query(`
            ALTER TABLE "users" 
            ADD COLUMN "promo_code" varchar(255) NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove promo_code column from users table
        await queryRunner.query(`
            ALTER TABLE "users" 
            DROP COLUMN "promo_code"
        `);
    }

}
