import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds platform-level crypto payout configuration to the shop_settings table.
 *
 * The CardCade shop has no creator user (prize_configurations.created_by IS
 * NULL), so we can't look up `solana_wallet` / `crypto_payments_enabled` on
 * a User row the way we do for individual sellers. Instead, admins configure
 * a treasury wallet directly on the cardcade row of `shop_settings` and
 * CryptoOrderService falls back to those fields whenever a prize has no
 * seller.
 */
export class AddCryptoToShopSettings20260502000000
  implements MigrationInterface
{
  name = 'AddCryptoToShopSettings20260502000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('shop_settings', [
      new TableColumn({
        name: 'crypto_payments_enabled',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
      new TableColumn({
        // Solana base58 pubkeys are 32 bytes → up to 44 chars; pad to 88
        // to leave headroom for any future address formats without forcing
        // another migration.
        name: 'crypto_wallet_address',
        type: 'varchar',
        length: '88',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('shop_settings', 'crypto_wallet_address');
    await queryRunner.dropColumn('shop_settings', 'crypto_payments_enabled');
  }
}
