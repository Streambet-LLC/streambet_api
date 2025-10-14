import { MigrationInterface, QueryRunner } from "typeorm";

export class StreamCreator1760350322785 implements MigrationInterface {
    name = 'StreamCreator1760350322785'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "is_creator" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD "revShare" numeric NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "streams" ADD "creatorId" uuid`);
        await queryRunner.query(`ALTER TABLE "streams" ADD CONSTRAINT "FK_a4ceb360aca29a92a6909a0ee04" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "streams" DROP COLUMN "creatorId"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "revShare"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_creator"`);
    }

}
