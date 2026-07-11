import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * One point-in-time market reading for a card (prize_configuration) from a
 * single source (eBay sold comps, Claude web research, TCGplayer, …).
 *
 * Append-only: every refresh writes a new row per source, so the table is the
 * historical price series we chart and reason over. Aggregate values are stored
 * in USD; `meta` carries source-specific extras (cited sources, notes, per-grade
 * pop, etc.).
 */
@Index('IDX_card_market_snapshots_card_captured', [
  'prizeConfigurationId',
  'capturedAt',
])
@Index('IDX_card_market_snapshots_card_source_captured', [
  'prizeConfigurationId',
  'source',
  'capturedAt',
])
@Entity('card_market_snapshots')
export class CardMarketSnapshot extends BaseEntity {
  @Column({ type: 'uuid' })
  prizeConfigurationId: string;

  /** Source key: 'ebay' | 'web' | 'tcgplayer' | 'pricecharting' | 'psa'. */
  @Column({ type: 'varchar', length: 24 })
  source: string;

  @Column({ type: 'timestamp' })
  capturedAt: Date;

  @Column({ type: 'varchar', length: 8, default: 'USD' })
  currency: string;

  @Column({ type: 'float', nullable: true })
  medianUsd: number | null;

  @Column({ type: 'float', nullable: true })
  lowUsd: number | null;

  @Column({ type: 'float', nullable: true })
  highUsd: number | null;

  @Column({ type: 'float', nullable: true })
  avgUsd: number | null;

  /** Number of comps/data points behind this reading, when known. */
  @Column({ type: 'int', nullable: true })
  sampleCount: number | null;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;
}
