import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index, Unique } from 'typeorm';

/**
 * The lifecycle of a single active marketplace listing, tracked across daily
 * snapshots. When a listing stops appearing in a segment's search it's marked
 * cleared (sold or pulled) — the disappearance is our real-time, leading
 * sell-through/velocity signal (eBay's true SOLD data is gated), and
 * lastSeen − firstSeen gives days-on-market ("listings that sit").
 */
@Entity('market_listings')
@Unique('UQ_market_listing', ['source', 'externalId', 'segment'])
export class MarketListing extends BaseEntity {
  /** Grouping key — a segment, set, or card topic (pokemon, set_pkm_151, …). */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  segment: string;

  /** 'ebay' for now. */
  @Column({ type: 'varchar', length: 16, default: 'ebay' })
  source: string;

  /** The listing's stable id on its source (eBay itemId). */
  @Column({ type: 'varchar', length: 128 })
  externalId: string;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'double precision', nullable: true })
  priceUsd: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency: string | null;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ type: 'timestamp' })
  firstSeenAt: Date;

  @Index()
  @Column({ type: 'timestamp' })
  lastSeenAt: Date;

  /** Still active in the latest snapshot. */
  @Index()
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** When the listing first stopped appearing (sold or pulled). */
  @Column({ type: 'timestamp', nullable: true })
  clearedAt: Date | null;
}
