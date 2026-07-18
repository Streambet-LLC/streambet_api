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

  /** Specific cards spiking/dropping right now. */
  @Column({ type: 'jsonb', nullable: true })
  movers:
    | {
        card: string;
        direction: string;
        changePct: number | null;
        note: string | null;
        url: string | null;
      }[]
    | null;

  /** Upcoming catalysts — set drops, restocks, tournaments, media tie-ins. */
  @Column({ type: 'jsonb', nullable: true })
  catalysts:
    | {
        title: string;
        timeframe: string | null;
        type: string | null;
        impact: string | null;
        note: string | null;
      }[]
    | null;

  /** Notable recent headline sales (social proof of a hot market). */
  @Column({ type: 'jsonb', nullable: true })
  sales:
    | {
        card: string;
        priceUsd: number | null;
        grade: string | null;
        venue: string | null;
        soldAt: string | null;
        url: string | null;
      }[]
    | null;
}
