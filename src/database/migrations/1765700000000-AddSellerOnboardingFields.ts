import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSellerOnboardingFields1765700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'seller_onboarding_completed',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'seller_trading_experience',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'seller_trading_experience');
    await queryRunner.dropColumn('users', 'seller_onboarding_completed');
  }
}
