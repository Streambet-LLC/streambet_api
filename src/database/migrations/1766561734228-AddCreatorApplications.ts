import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreatorApplications1766561734228 implements MigrationInterface {
    name = 'AddCreatorApplications1766561734228'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "creator_applications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "firstName" character varying(255) NOT NULL, "lastName" character varying(255) NOT NULL, "email" character varying(255) NOT NULL, "socials" text NOT NULL, "message" text NOT NULL, "is_deleted" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_d1b7eb7218323d0fd1de08c70c1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "creator_applications" ADD CONSTRAINT "FK_d85268358b352c88dc2c92dd2cc" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "creator_applications" DROP CONSTRAINT "FK_d85268358b352c88dc2c92dd2cc"`);
        await queryRunner.query(`DROP TABLE "creator_applications"`);
    }

}
