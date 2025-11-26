import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLockDateToBettingRound1763992286888 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "betting_rounds" ADD "lockDate" TIMESTAMPTZ`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "betting_rounds" DROP COLUMN "lockDate"`);
    }

}
