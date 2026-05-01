import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCryptoPaymentsToUsers1761234567890
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    // Add Solana wallet address to users
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'solana_wallet',
        type: 'varchar',
        length: '88',
        isNullable: true,
        comment: 'Base58-encoded Solana wallet address (public key)',
      }),
    );

    // Add crypto payments enabled flag to users (default false)
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'crypto_payments_enabled',
        type: 'boolean',
        default: false,
        isNullable: false,
        comment: 'Whether this user is enabled to receive crypto payments',
      }),
    );

    // Add per-seller override fee (in basis points)
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'crypto_override_fee_bps',
        type: 'smallint',
        isNullable: true,
        comment:
          'Optional seller fee override (bps) for crypto payments. Overrides the default seller group fee.',
      }),
    );

    // Add crypto payment fields to prize_orders
    // Payment method now includes 'crypto'
    await queryRunner.query(
      `ALTER TABLE prize_orders DROP CONSTRAINT IF EXISTS "CHK_payment_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE prize_orders ADD CONSTRAINT "CHK_payment_method" CHECK (payment_method IN ('coins', 'usd', 'combined', 'crypto'))`,
    );

    // Solana transaction signature for crypto payments
    await queryRunner.addColumn(
      'prize_orders',
      new TableColumn({
        name: 'crypto_tx_signature',
        type: 'varchar',
        length: '88',
        isNullable: true,
        comment: 'Solana transaction signature for crypto payments',
      }),
    );

    // Buyer wallet address for crypto payments
    await queryRunner.addColumn(
      'prize_orders',
      new TableColumn({
        name: 'crypto_buyer_wallet',
        type: 'varchar',
        length: '88',
        isNullable: true,
        comment: 'Buyer Solana wallet address (public key) for crypto payments',
      }),
    );

    // Invoice ID for replay protection
    await queryRunner.addColumn(
      'prize_orders',
      new TableColumn({
        name: 'crypto_invoice_id',
        type: 'bytea',
        isNullable: true,
        comment: '16-byte invoice ID for replay protection (hex encoded in DB)',
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Drop prize_orders columns
    await queryRunner.dropColumn('prize_orders', 'crypto_invoice_id');
    await queryRunner.dropColumn('prize_orders', 'crypto_buyer_wallet');
    await queryRunner.dropColumn('prize_orders', 'crypto_tx_signature');

    // Revert payment_method constraint
    await queryRunner.query(
      `ALTER TABLE prize_orders DROP CONSTRAINT IF EXISTS "CHK_payment_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE prize_orders ADD CONSTRAINT "CHK_payment_method" CHECK (payment_method IN ('coins', 'usd', 'combined'))`,
    );

    // Drop users columns
    await queryRunner.dropColumn('users', 'crypto_override_fee_bps');
    await queryRunner.dropColumn('users', 'crypto_payments_enabled');
    await queryRunner.dropColumn('users', 'solana_wallet');
  }
}
