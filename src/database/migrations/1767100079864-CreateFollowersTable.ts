import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateFollowersTable1767100079864 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS followers (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                followed_uuid uuid NOT NULL,
                follower_uuid uuid NOT NULL,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS followers`);
    }

}
