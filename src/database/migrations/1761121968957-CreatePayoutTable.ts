import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePayoutTable1761121968957 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS platform_payouts (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                betting_round uuid NOT NULL,
                assigned_creator uuid,
                creator_split_pct decimal(10,2),
                platform_payout_amount decimal(10,2),
                creator_split_amount decimal(10,2),
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            ALTER TYPE transactions_type_enum ADD VALUE 'Creator Payout'; 
        `);

    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS platform_payouts`);
    }

}
