import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateTransactionAmountBalanceToDecimal1756026613632
  implements MigrationInterface
{
  name = 'UpdateTransactionAmountBalanceToDecimal1756026613632';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Change `amount` column type to decimal(12,3)
    await queryRunner.query(`
      ALTER TABLE "transactions"
      ALTER COLUMN "amount" TYPE decimal(12,3)
      USING "amount"::decimal(12,3)
    `);

    // Change `balanceAfter` column type to decimal(12,3)
    await queryRunner.query(`
      ALTER TABLE "transactions"
      ALTER COLUMN "balanceAfter" TYPE decimal(12,3)
      USING "balanceAfter"::decimal(12,3)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert back to integer
    await queryRunner.query(`
      ALTER TABLE "transactions"
      ALTER COLUMN "amount" TYPE integer
      USING round("amount")::integer
    `);

    await queryRunner.query(`
      ALTER TABLE "transactions"
      ALTER COLUMN "balanceAfter" TYPE integer
      USING round("balanceAfter")::integer
    `);
  }
}
