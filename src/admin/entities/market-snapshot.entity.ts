import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A point-in-time read on the BROADER hobby market for one segment
 * (pokemon, sports, all TCG, …), researched by Claude from the live web.
 * Append-only: each refresh adds a row so we build a historical series of
 * market indices to chart on the market dashboard.
 */
@Index('IDX_market_snapshots_segment_captured', ['segment', 'capturedAt'])
@Entity('market_snapshots')
export class MarketSnapshot extends BaseEntity {
  /** Segment key: 'pokemon' | 'one_piece' | 'sports' | 'magic' | 'lorcana' | 'all'. */
  @Column({ type: 'varchar', length: 24 })
  segment: string;

  @Column({ type: 'timestamp' })
  capturedAt: Date;

  /** Metric key → 0-100 index value (AI estimate). */
  @Column({ type: 'jsonb' })
  metrics: Record<string, number>;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /** Notable movers / hot cards / news bullets. */
  @Column({ type: 'jsonb', nullable: true })
  highlights: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  sources: { title: string; url: string }[] | null;
}
