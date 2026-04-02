import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

export class AddCardCadeProFeature1743465600000 implements MigrationInterface {
  name = 'AddCardCadeProFeature1743465600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create subscription plan enum
    await queryRunner.query(
      `CREATE TYPE "subscription_plan_enum" AS ENUM ('monthly', 'yearly')`,
    );

    // 2. Create subscription status enum
    await queryRunner.query(
      `CREATE TYPE "subscription_status_enum" AS ENUM ('active', 'cancelled', 'past_due', 'expired')`,
    );

    // 3. Create subscriptions table
    await queryRunner.createTable(
      new Table({
        name: 'subscriptions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'user_id', type: 'uuid', isNullable: false },
          {
            name: 'plan',
            type: 'subscription_plan_enum',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'subscription_status_enum',
            default: `'active'`,
            isNullable: false,
          },
          {
            name: 'stripe_subscription_id',
            type: 'varchar',
            length: '255',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'stripe_customer_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'stripe_price_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'current_period_start',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'current_period_end',
            type: 'timestamp',
            isNullable: true,
          },
          { name: 'cancelled_at', type: 'timestamp', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    // 4. Create concierge_request_status enum
    await queryRunner.query(
      `CREATE TYPE "concierge_request_status_enum" AS ENUM ('pending', 'claimed')`,
    );

    // 5. Create concierge_requests table
    await queryRunner.createTable(
      new Table({
        name: 'concierge_requests',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'user_id', type: 'uuid', isNullable: false },
          {
            name: 'status',
            type: 'concierge_request_status_enum',
            default: `'pending'`,
            isNullable: false,
          },
          { name: 'claimed_by', type: 'uuid', isNullable: true },
          {
            name: 'claimed_by_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          { name: 'claimed_at', type: 'timestamp', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['claimed_by'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    // 6. Add is_pro_subscriber to users table
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'is_pro_subscriber',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
    );

    // 7. Add is_pro_only to prize_configurations table
    await queryRunner.addColumn(
      'prize_configurations',
      new TableColumn({
        name: 'is_pro_only',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
    );

    // 8. Add pro_early_access_until to prize_configurations table
    await queryRunner.addColumn(
      'prize_configurations',
      new TableColumn({
        name: 'pro_early_access_until',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove columns
    await queryRunner.dropColumn(
      'prize_configurations',
      'pro_early_access_until',
    );
    await queryRunner.dropColumn('prize_configurations', 'is_pro_only');
    await queryRunner.dropColumn('users', 'is_pro_subscriber');

    // Drop tables
    await queryRunner.dropTable('concierge_requests');
    await queryRunner.dropTable('subscriptions');

    // Drop enums
    await queryRunner.query(`DROP TYPE "concierge_request_status_enum"`);
    await queryRunner.query(`DROP TYPE "subscription_status_enum"`);
    await queryRunner.query(`DROP TYPE "subscription_plan_enum"`);
  }
}
