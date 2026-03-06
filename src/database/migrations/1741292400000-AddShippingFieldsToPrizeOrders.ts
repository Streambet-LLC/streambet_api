import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddShippingFieldsToPrizeOrders1741292400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'prize_orders',
      new TableColumn({
        name: 'tracking_number',
        type: 'varchar',
        length: '255',
        isNullable: true,
        default: null,
      }),
    );

    await queryRunner.addColumn(
      'prize_orders',
      new TableColumn({
        name: 'shipping_carrier',
        type: 'varchar',
        length: '100',
        isNullable: true,
        default: null,
      }),
    );

    await queryRunner.addColumn(
      'prize_orders',
      new TableColumn({
        name: 'shipped_at',
        type: 'timestamp',
        isNullable: true,
        default: null,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('prize_orders', 'shipped_at');
    await queryRunner.dropColumn('prize_orders', 'shipping_carrier');
    await queryRunner.dropColumn('prize_orders', 'tracking_number');
  }
}
