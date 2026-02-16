import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreatePrizeOrdersTable1708033200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'prize_orders',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'prize_configuration_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'shipping_address',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'payment_method',
            type: 'varchar',
            isNullable: false,
            comment: 'coins, usd, or combined',
          },
          {
            name: 'coins_deducted',
            type: 'numeric',
            precision: 10,
            scale: 2,
            default: 0,
          },
          {
            name: 'usd_charged',
            type: 'numeric',
            precision: 10,
            scale: 2,
            default: 0,
          },
          {
            name: 'total_price',
            type: 'numeric',
            precision: 10,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'stripe_session_id',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'stripe_payment_intent_id',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            default: "'pending'",
            comment: 'pending, paid, processing, shipped, delivered, cancelled',
          },
        ],
      }),
      true,
    );

    // Create foreign key to users table
    await queryRunner.createForeignKey(
      'prize_orders',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Create foreign key to prize_configuration table
    await queryRunner.createForeignKey(
      'prize_orders',
      new TableForeignKey({
        columnNames: ['prize_configuration_id'],
        referencedTableName: 'prize_configurations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('prize_orders');
    if (table) {
      // Drop foreign keys
      const foreignKeys = table.foreignKeys;
      for (const fk of foreignKeys) {
        await queryRunner.dropForeignKey('prize_orders', fk);
      }
      // Drop table
      await queryRunner.dropTable('prize_orders');
    }
  }
}
