import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add DAILY_SPIN transaction type and performance indexes
 */
export class AddDailySpinTransactionType1770677038000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_type_enum" ADD VALUE IF NOT EXISTS 'Daily spin reward'`,
    );

    // Index for daily spin status queries (userId + type + createdAt)
    await queryRunner.query(
      `CREATE INDEX "idx_transactions_user_type_created" 
       ON "transactions"("userId", "type", "createdAt" DESC)`,
    );

    // Partial index for idempotency checks (relatedEntityId + relatedEntityType)
    await queryRunner.query(
      `CREATE INDEX "idx_transactions_related_entity" 
       ON "transactions"("relatedEntityId", "relatedEntityType") 
       WHERE "relatedEntityId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_transactions_related_entity"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_transactions_user_type_created"`,
    );

    // Note: PostgreSQL does not support removing enum values directly
    // You would need to recreate the enum if downgrade is necessary
    // This is commented out as it's rarely needed and can cause issues
    // await queryRunner.query(`
    //     ALTER TYPE transaction_type_enum RENAME TO transaction_type_enum_old;
    //     CREATE TYPE transaction_type_enum AS ENUM(...all existing values...);
    //     ALTER TABLE transactions ALTER COLUMN type TYPE transaction_type_enum USING type::text::transaction_type_enum;
    //     DROP TYPE transaction_type_enum_old;
    // `);
  }
}
