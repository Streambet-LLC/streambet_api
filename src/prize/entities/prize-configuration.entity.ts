import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { PrizePurchaseOption } from '../enums/prize-purchase-option.enum';
import { PrizeBrand } from '../enums/prize-brand.enum';
import { PrizeSaleType } from '../enums/prize-sale-type.enum';
import { ItemConfigurationImage } from './item-configuration-image.entity';
import { Auction } from './auction.entity';

/**
 * Entity for storing prize tier configurations.
 * Each prize tier (level) gets its own row with a unique ID.
 * Data hardening: Updates create new rows instead of modifying existing ones.
 */
@Entity('prize_configurations')
export class PrizeConfiguration extends BaseEntity {
  @Column({ type: 'integer', name: 'prize_tier' })
  prizeTier: number;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 500, name: 'image_url', nullable: true })
  imageUrl: string | null;

  @Column({ type: 'uuid', name: 'cover_image_id', nullable: true })
  coverImageId: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({
    type: 'enum',
    enum: ['raw', 'slab', 'sealed', 'other'],
    name: 'category',
    nullable: false,
    default: 'slab',
  })
  category: 'raw' | 'slab' | 'sealed' | 'other';

  @Column({ type: 'varchar', length: 10, name: 'grade', nullable: true })
  grade: string | null;

  @Column({ type: 'integer', name: 'stock', default: 0, nullable: false })
  stock: number;

  @Column({
    type: 'enum',
    enum: PrizePurchaseOption,
    name: 'purchase_option',
    default: PrizePurchaseOption.BOTH,
  })
  purchaseOption: PrizePurchaseOption;

  @Column({
    type: 'enum',
    enum: PrizeBrand,
    name: 'brand',
    default: PrizeBrand.POKEMON,
  })
  brand: PrizeBrand;

  /**
   * How this item is sold. Defaults to fixed_price (existing behavior).
   * `auction` items are managed via the `auctions` table and are excluded
   * from CadeCoin purchase flows and from the redemptions page.
   */
  @Column({
    type: 'enum',
    enum: PrizeSaleType,
    name: 'sale_type',
    default: PrizeSaleType.FIXED_PRICE,
  })
  saleType: PrizeSaleType;

  /**
   * Internal card value (USD) recorded by admin at auction setup time.
   * Not surfaced to end users — used for analytics / accounting.
   */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'card_value_usd',
    nullable: true,
  })
  cardValueUsd: string | null;

  /**
   * Per-item shipping fee in USD. Defaults to $5.00 (matches the legacy
   * hard-coded constant). Currently surfaced in the auction bidder UX
   * so winners see the full "if I win" total before placing a bid.
   */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'shipping_cost_usd',
    default: 5,
  })
  shippingCostUsd: string;

  @Column({ type: 'integer', name: 'display_order_shop', nullable: true })
  displayOrderShop: number | null;

  @Column({
    type: 'integer',
    name: 'display_order_seller_shop',
    nullable: true,
  })
  sellerDisplayOrderShop: number | null;

  @Column({
    type: 'integer',
    name: 'display_order_redemptions',
    nullable: true,
  })
  displayOrderRedemptions: number | null;

  @Column({ type: 'integer', name: 'featured_display_order', nullable: true })
  featuredDisplayOrder: number | null;

  @Column({
    type: 'boolean',
    name: 'sort_by_purchase_option_shop',
    default: false,
  })
  sortByPurchaseOptionShop: boolean;

  @Column({
    type: 'boolean',
    name: 'sort_by_purchase_option_redemptions',
    default: false,
  })
  sortByPurchaseOptionRedemptions: boolean;

  @Column({
    type: 'boolean',
    name: 'show_on_redemptions',
    default: true,
    nullable: false,
  })
  showOnRedemptions: boolean;

  @Column({
    type: 'boolean',
    name: 'show_on_shop',
    default: true,
    nullable: false,
  })
  showOnShop: boolean;

  @Column({ type: 'boolean', name: 'profile_featured', default: false })
  profileFeatured: boolean;

  @Column({ type: 'boolean', name: 'is_pro_only', default: false })
  isProOnly: boolean;

  @Column({ type: 'timestamp', name: 'pro_early_access_until', nullable: true })
  proEarlyAccessUntil: Date | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy: string | null;

  @Column({ type: 'uuid', name: 'stripe_product_id', nullable: true })
  stripeProductId: string | null;

  /**
   * Cached count of distinct (user|anon) views, deduped per day. Maintained
   * incrementally by the views service; the source of truth lives in
   * `prize_item_views`.
   */
  @Column({ type: 'integer', name: 'view_count', default: 0 })
  viewCount: number;

  /**
   * Cached count of users currently watching this item. Maintained
   * incrementally by the watchers service; the source of truth lives in
   * `prize_item_watchers`.
   */
  @Column({ type: 'integer', name: 'watcher_count', default: 0 })
  watcherCount: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'updated_by' })
  updater: User;

  /**
   * 1:1 inverse-side link to the auction (if `saleType === 'auction'`).
   * Eager-loaded so list endpoints can return auction state without a
   * second round-trip. Auctions table is small (one row per auction item)
   * so the LEFT JOIN cost is negligible.
   */
  @OneToOne(() => Auction, (a) => a.prizeConfiguration, { eager: true })
  auction: Auction | null;

  @OneToMany(
    () => ItemConfigurationImage,
    (itemImage) => itemImage.prizeConfiguration,
  )
  itemImages: ItemConfigurationImage[];
}
