import { MigrationInterface, QueryRunner } from "typeorm";

export class WebhookWithdrawalStreamsMigration1759901384357 implements MigrationInterface {
    name = 'WebhookWithdrawalStreamsMigration1759901384357'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "webhook" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "provider" character varying(255) NOT NULL, "data" text NOT NULL, CONSTRAINT "PK_e6765510c2d078db49632b59020" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TYPE "public"."transactions_type_enum" RENAME TO "transactions_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."transactions_type_enum" AS ENUM('Deposit', 'Withdrawal', 'Withdrawal Pending', 'Withdrawal Success', 'Withdrawal Failed', 'Bet placement', 'Bet winnings', 'Bet loss', 'Purchase coins', 'Refund', 'Initial credit', 'Admin credit', 'Admin debited', 'Bonus coins')`);
        await queryRunner.query(`ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "public"."transactions_type_enum" USING "type"::"text"::"public"."transactions_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."transactions_type_enum_old"`);
        await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "relatedEntityId"`);
        await queryRunner.query(`ALTER TABLE "transactions" ADD "relatedEntityId" character varying(500)`);
        await queryRunner.query(`ALTER TYPE "public"."streams_status_enum" RENAME TO "streams_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."streams_status_enum" AS ENUM('scheduled', 'live', 'ended', 'cancelled', 'deleted', 'active')`);
        await queryRunner.query(`ALTER TABLE "streams" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "streams" ALTER COLUMN "status" TYPE "public"."streams_status_enum" USING "status"::"text"::"public"."streams_status_enum"`);
        await queryRunner.query(`ALTER TABLE "streams" ALTER COLUMN "status" SET DEFAULT 'scheduled'`);
        await queryRunner.query(`DROP TYPE "public"."streams_status_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."streams_status_enum_old" AS ENUM('scheduled', 'live', 'ended', 'cancelled', 'deleted')`);
        await queryRunner.query(`ALTER TABLE "streams" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "streams" ALTER COLUMN "status" TYPE "public"."streams_status_enum_old" USING "status"::"text"::"public"."streams_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "streams" ALTER COLUMN "status" SET DEFAULT 'scheduled'`);
        await queryRunner.query(`DROP TYPE "public"."streams_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."streams_status_enum_old" RENAME TO "streams_status_enum"`);
        await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "relatedEntityId"`);
        await queryRunner.query(`ALTER TABLE "transactions" ADD "relatedEntityId" uuid`);
        await queryRunner.query(`CREATE TYPE "public"."transactions_type_enum_old" AS ENUM('Deposit', 'Withdrawal', 'Bet placement', 'Bet winnings', 'Bet loss', 'Purchase coins', 'Refund', 'Initial credit', 'Admin credit', 'Admin debited', 'Bonus coins')`);
        await queryRunner.query(`ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "public"."transactions_type_enum_old" USING "type"::"text"::"public"."transactions_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."transactions_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."transactions_type_enum_old" RENAME TO "transactions_type_enum"`);
        await queryRunner.query(`DROP TABLE "webhook"`);
    }

}
