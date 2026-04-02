import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { PrizePurchaseOption } from '../enums/prize-purchase-option.enum';
import { PrizeBrand } from '../enums/prize-brand.enum';
import { ItemConfigurationImage } from './item-configuration-image.entity';

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
    enum: ['slab', 'sealed'],
    name: 'category',
    nullable: false,
    default: 'slab',
  })
  category: 'slab' | 'sealed';

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

  @Column({ type: 'integer', name: 'display_order_shop', nullable: true })
  displayOrderShop: number | null;

  @Column({ type: 'integer', name: 'display_order_seller_shop', nullable: true })
  sellerDisplayOrderShop: number | null;

  @Column({ type: 'integer', name: 'display_order_redemptions', nullable: true })
  displayOrderRedemptions: number | null;

  @Column({ type: 'integer', name: 'featured_display_order', nullable: true })
  featuredDisplayOrder: number | null;

  @Column({ type: 'boolean', name: 'sort_by_purchase_option_shop', default: false })
  sortByPurchaseOptionShop: boolean;

  @Column({ type: 'boolean', name: 'sort_by_purchase_option_redemptions', default: false })
  sortByPurchaseOptionRedemptions: boolean;

  @Column({ type: 'boolean', name: 'show_on_redemptions', default: true, nullable: false })
  showOnRedemptions: boolean;

  @Column({ type: 'boolean', name: 'show_on_shop', default: true, nullable: false })
  showOnShop: boolean;

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

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'updated_by' })
  updater: User;

  @OneToMany(
    () => ItemConfigurationImage,
    (itemImage) => itemImage.prizeConfiguration,
  )
  itemImages: ItemConfigurationImage[];
}
