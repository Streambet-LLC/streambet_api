import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIsPromotedToStreams1762983671694 implements MigrationInterface {
    name = 'AddIsPromotedToStreams1762983671694'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "streams" ADD "isPromoted" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "streams" DROP COLUMN "isPromoted"`);
    }

}
