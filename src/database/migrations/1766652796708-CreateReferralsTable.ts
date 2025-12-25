import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateReferralsTable1766652796708 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS referral_links (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                user_uuid uuid NOT NULL,
                slug varchar(255) NOT NULL,
                is_active bool DEFAULT true,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS referral_links`);
    }

}
