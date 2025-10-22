import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSocialstoUser1761022736971 implements MigrationInterface {
    name = 'AddSocialstoUser1761022736971'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "socials" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "socials"`);
    }

}
