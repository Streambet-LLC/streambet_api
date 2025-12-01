import { MigrationInterface, QueryRunner } from "typeorm";

export class DropUniqueConstraintFromBettingRoundsCreatedBy1764620716002 implements MigrationInterface {
    name = 'DropUniqueConstraintFromBettingRoundsCreatedBy1764620716002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "betting_rounds" DROP CONSTRAINT "FK_03d0ebfc55f5071b82bbd1a38a7"`);
        await queryRunner.query(`ALTER TABLE "betting_rounds" DROP CONSTRAINT "UQ_03d0ebfc55f5071b82bbd1a38a7"`);
        await queryRunner.query(`ALTER TABLE "betting_rounds" ADD CONSTRAINT "FK_03d0ebfc55f5071b82bbd1a38a7" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "betting_rounds" DROP CONSTRAINT "FK_03d0ebfc55f5071b82bbd1a38a7"`);
        await queryRunner.query(`ALTER TABLE "betting_rounds" ADD CONSTRAINT "UQ_03d0ebfc55f5071b82bbd1a38a7" UNIQUE ("createdBy")`);
        await queryRunner.query(`ALTER TABLE "betting_rounds" ADD CONSTRAINT "FK_03d0ebfc55f5071b82bbd1a38a7" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
