import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLiveFeedUpdate1770651506180 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS live_feed_updates (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                type varchar(255) NOT NULL,
                username varchar(255),
                stream varchar(255),
                round varchar(255),
                option varchar(255),
                amount decimal(10,2) DEFAULT 0,
                ranking int DEFAULT 0,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS live_feed_updates`);
  }
}
