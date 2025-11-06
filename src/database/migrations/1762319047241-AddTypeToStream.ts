import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTypeToStream1762319047241 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE event_type AS ENUM ('stream', 'non-video')`)
        await queryRunner.query(`ALTER TABLE streams ADD COLUMN type event_type DEFAULT 'stream'`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TYPE event_type`);
        await queryRunner.query(`ALTER TABLE streams DROP COLUMN type;`);
    }

}
