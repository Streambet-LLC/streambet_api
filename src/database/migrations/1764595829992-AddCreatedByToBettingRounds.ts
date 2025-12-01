import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreatedByToBettingRounds1764595829992 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "betting_rounds" ADD "createdBy" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "betting_rounds" DROP COLUMN "createdBy"`);
    }

}
