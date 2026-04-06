import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableUnique,
} from 'typeorm';

export class CreateCartTables1751700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create carts table
    await queryRunner.createTable(
      new Table({
        name: 'carts',
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
            isUnique: true,
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'carts',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    // Create cart_items table
    await queryRunner.createTable(
      new Table({
        name: 'cart_items',
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
            name: 'cart_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'prize_configuration_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'quantity',
            type: 'integer',
            default: 1,
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'cart_items',
      new TableForeignKey({
        columnNames: ['cart_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'carts',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'cart_items',
      new TableForeignKey({
        columnNames: ['prize_configuration_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'prize_configurations',
        onDelete: 'CASCADE',
      }),
    );

    // Add unique constraint on [cart_id, prize_configuration_id]
    await queryRunner.createUniqueConstraint(
      'cart_items',
      new TableUnique({
        name: 'UQ_cart_items_cart_prize',
        columnNames: ['cart_id', 'prize_configuration_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('cart_items', true, true);
    await queryRunner.dropTable('carts', true, true);
  }
}
