import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateShopSettingsTable1742918400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'shop_settings',
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
            name: 'shop_key',
            type: 'varchar',
            length: '100',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'display_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'profile_image_url',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          {
            name: 'socials',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'seller_trading_experience',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'city',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'state',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'country',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('shop_settings');
  }
}
