import { Entity, Column, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { PrizeConfiguration } from './prize-configuration.entity';
import { User } from '../../users/entities/user.entity';

@Entity('prize_item_ebay_sold_listings')
export class PrizeItemEbaySoldListing extends BaseEntity {
  @Column({ type: 'uuid', name: 'item_id' })
  itemId: string;

  @ManyToOne(() => PrizeConfiguration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item: PrizeConfiguration;

  @Column({
    type: 'varchar',
    name: 'provider_item_id',
    length: 128,
    nullable: true,
  })
  providerItemId: string | null;

  @Column({ type: 'varchar', name: 'source', length: 64, default: 'scrapechain' })
  source: string;

  @Column({ type: 'varchar', name: 'search_query', length: 255 })
  searchQuery: string;

  @Column({ type: 'varchar', name: 'sold_title', length: 500 })
  soldTitle: string;

  @Column({ type: 'numeric', name: 'sale_price', precision: 12, scale: 2 })
  salePrice: string;

  @Column({
    type: 'varchar',
    name: 'currency_symbol',
    length: 16,
    nullable: true,
  })
  currencySymbol: string | null;

  @Column({ type: 'timestamp', name: 'date_sold', nullable: true })
  dateSold: Date | null;

  @Column({ type: 'varchar', name: 'image_url', length: 1000, nullable: true })
  imageUrl: string | null;

  @Column({ type: 'varchar', name: 'listing_url', length: 1000, nullable: true })
  listingUrl: string | null;

  @Column({
    type: 'numeric',
    name: 'shipping_price',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  shippingPrice: string | null;

  @Column({ type: 'varchar', name: 'item_condition', length: 120, nullable: true })
  itemCondition: string | null;

  @Column({
    type: 'varchar',
    name: 'buying_format',
    length: 120,
    nullable: true,
  })
  buyingFormat: string | null;

  @Column({ type: 'text', name: 'response_url', nullable: true })
  responseUrl: string | null;

  @Column({ type: 'jsonb', name: 'raw_payload', nullable: true })
  rawPayload: Record<string, unknown> | null;

  @Column({ type: 'timestamp', name: 'fetched_at', default: () => 'now()' })
  fetchedAt: Date;

  @Column({ type: 'boolean', name: 'is_inaccurate', default: false })
  isInaccurate: boolean;

  @Column({ type: 'text', name: 'inaccurate_reason', nullable: true })
  inaccurateReason: string | null;

  @Column({ type: 'uuid', name: 'inaccurate_flagged_by_user_id', nullable: true })
  inaccurateFlaggedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'inaccurate_flagged_by_user_id' })
  inaccurateFlaggedByUser: User | null;

  @Column({ type: 'timestamp', name: 'inaccurate_flagged_at', nullable: true })
  inaccurateFlaggedAt: Date | null;
}
