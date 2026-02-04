import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBetRoundEvents1768999830584 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS bet_round_history (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                bet_round_uuid uuid NOT NULL,
                event_type varchar(255) NOT NULL,
                causer_id uuid NOT NULL,
                description text,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS bet_round_history`);
  }
}
