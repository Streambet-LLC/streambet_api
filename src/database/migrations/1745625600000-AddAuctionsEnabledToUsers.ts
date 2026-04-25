import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds the `auctions_enabled` per-user feature flag. Defaults to false so
 * existing users see no behavior change; admins flip it on per-user from
 * the admin Users tab as we roll auctions out to select sellers.
 */
export class AddAuctionsEnabledToUsers1745625600000
  implements MigrationInterface
{
  name = 'AddAuctionsEnabledToUsers1745625600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'auctions_enabled',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'auctions_enabled');
  }
}
