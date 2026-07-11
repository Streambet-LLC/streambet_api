import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cached predictive intelligence forecasts per card (Claude + web research).
 */
export class CreateCardForecasts20260703130000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "card_forecasts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "prizeConfigurationId" uuid NOT NULL,
        "forecast" jsonb NOT NULL,
        "generatedAt" TIMESTAMP NOT NULL,
        "generatedByAdminId" uuid,
        CONSTRAINT "PK_card_forecasts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_card_forecast_card" UNIQUE ("prizeConfigurationId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "card_forecasts"`);
  }
}
