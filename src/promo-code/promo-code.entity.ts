import { BaseEntity } from '../common/entities/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('promo_codes')
export class PromoCode extends BaseEntity {
  @Column({ name: 'code', unique: true })
  code: string;

  @Column({ name: 'currency', default: 'usd' })
  currency: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'amount',
    default: 0,
    comment: 'Legacy: flat coin bonus amount. Not used for cart discounts.',
  })
  amount: number;

  // ── New cart-discount fields ──

  @Column({
    type: 'varchar',
    length: 20,
    name: 'discount_type',
    default: 'percent',
    comment: '"percent" or "fixed_amount"',
  })
  discountType: 'percent' | 'fixed_amount';

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'discount_percent',
    nullable: true,
    comment: 'Percentage off (e.g. 5.00 means 5%)',
  })
  discountPercent?: number;

  @Column({
    type: 'integer',
    name: 'discount_amount_cents',
    nullable: true,
    comment: 'Fixed discount in cents (e.g. 1000 = $10.00)',
  })
  discountAmountCents?: number;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'usage_type',
    default: 'per_account',
    comment: '"per_account" = each user once, "single_use" = one global use',
  })
  usageType: 'per_account' | 'single_use';

  @Column({
    type: 'integer',
    name: 'max_uses',
    nullable: true,
    comment: 'Max total uses. null = unlimited (for per_account)',
  })
  maxUses?: number;

  @Column({
    type: 'integer',
    name: 'times_used',
    default: 0,
    comment: 'How many times this code has been redeemed',
  })
  timesUsed: number;

  @Column({
    type: 'boolean',
    name: 'is_active',
    default: true,
  })
  isActive: boolean;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'scope',
    default: 'cart',
    comment:
      '"cart" = discount applies to whole cart subtotal, "cheapest_item" = discount applies only to cheapest item',
  })
  scope: 'cart' | 'cheapest_item';

  @Column({
    type: 'timestamp',
    name: 'expires_at',
    nullable: true,
  })
  expiresAt?: Date;
}
