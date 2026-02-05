import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSentimentPickVotesTable1739000000000
  implements MigrationInterface
{
  name = 'CreateSentimentPickVotesTable1739000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the sentiment_pick_votes table
    await queryRunner.query(`
      CREATE TABLE "sentiment_pick_votes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "bettingRoundId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_sentiment_pick_votes_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sentiment_pick_votes_round" FOREIGN KEY ("bettingRoundId") REFERENCES "betting_rounds"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_sentiment_pick_votes_user_round" UNIQUE ("userId", "bettingRoundId")
      )
    `);

    // Create indexes for faster lookups
    await queryRunner.query(`
      CREATE INDEX "IDX_sentiment_pick_votes_userId" ON "sentiment_pick_votes"("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_sentiment_pick_votes_bettingRoundId" ON "sentiment_pick_votes"("bettingRoundId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX "IDX_sentiment_pick_votes_bettingRoundId"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_sentiment_pick_votes_userId"
    `);

    // Drop table
    await queryRunner.query(`
      DROP TABLE "sentiment_pick_votes"
    `);
  }
}
