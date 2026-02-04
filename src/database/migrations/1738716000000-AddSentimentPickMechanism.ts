import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSentimentPickMechanism1738716000000
  implements MigrationInterface
{
  name = 'AddSentimentPickMechanism1738716000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the pick_mechanism enum type
    await queryRunner.query(`
      CREATE TYPE "betting_rounds_mechanism_enum" AS ENUM('default', 'sentiment')
    `);

    // Add mechanism column with default value
    await queryRunner.query(`
      ALTER TABLE "betting_rounds" 
      ADD "mechanism" "betting_rounds_mechanism_enum" NOT NULL DEFAULT 'default'
    `);

    // Add timestamp columns for sentiment picks
    await queryRunner.query(`
      ALTER TABLE "betting_rounds" 
      ADD "firstRevealTime" TIMESTAMP NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "betting_rounds" 
      ADD "lastRevealTime" TIMESTAMP NULL
    `);

    // Add boolean flag for initial reveal period
    await queryRunner.query(`
      ALTER TABLE "betting_rounds" 
      ADD "isInitialRevealPeriod" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop columns in reverse order
    await queryRunner.query(`
      ALTER TABLE "betting_rounds" DROP COLUMN "isInitialRevealPeriod"
    `);

    await queryRunner.query(`
      ALTER TABLE "betting_rounds" DROP COLUMN "lastRevealTime"
    `);

    await queryRunner.query(`
      ALTER TABLE "betting_rounds" DROP COLUMN "firstRevealTime"
    `);

    await queryRunner.query(`
      ALTER TABLE "betting_rounds" DROP COLUMN "mechanism"
    `);

    // Drop the enum type
    await queryRunner.query(`
      DROP TYPE "betting_rounds_mechanism_enum"
    `);
  }
}
