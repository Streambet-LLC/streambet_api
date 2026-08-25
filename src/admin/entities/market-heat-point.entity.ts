import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * One daily computed snapshot of real-time, LEADING heat indicators for a
 * market segment — derived from active-listing snapshots (not retroactive sold
 * comps). These accrue into a time series so momentum is visible before it
 * shows up in sold prices.
 */
@Entity('market_heat_points')
@Index('IDX_market_heat_seg_time', ['segment', 'capturedAt'])
export class MarketHeatPoint extends BaseEntity {
  /** Grouping key — a segment, set, or card topic. */
  @Column({ type: 'varchar', length: 64 })
  segment: string;

  /** 'segment' | 'set' | 'card' — the granularity of this market. */
  @Index()
  @Column({ type: 'varchar', length: 16, default: 'segment' })
  scope: string;

  /** Human-readable name (e.g. "Pokémon 151", "Umbreon VMAX Alt Art"). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  label: string | null;

  @Column({ type: 'timestamp' })
  capturedAt: Date;

  /** True total active listings for the segment (real supply level). */
  @Column({ type: 'int', nullable: true })
  totalActive: number | null;

  /** Day-over-day change in total active listings (supply momentum), %. */
  @Column({ type: 'double precision', nullable: true })
  totalActiveChangePct: number | null;

  /** Listings we track in the sample that are currently active. */
  @Column({ type: 'int', default: 0 })
  sampleActive: number;

  /** Listings first seen in this snapshot (fresh supply hitting the market). */
  @Column({ type: 'int', default: 0 })
  newCount: number;

  /** Listings that disappeared since the last snapshot (sold or pulled). */
  @Column({ type: 'int', default: 0 })
  clearedCount: number;

  /** clearedCount / prior active — the sell-through / velocity proxy, %. */
  @Column({ type: 'double precision', nullable: true })
  clearedRatePct: number | null;

  /** Median days-on-market for currently-active listings. */
  @Column({ type: 'double precision', nullable: true })
  medianDaysListed: number | null;

  /** Share of active listings older than 14 days ("listings that sit"), %. */
  @Column({ type: 'double precision', nullable: true })
  agingPct: number | null;

  /** Median active ask (USD). */
  @Column({ type: 'double precision', nullable: true })
  medianAskUsd: number | null;

  /** Day-over-day change in median ask (price momentum), %. */
  @Column({ type: 'double precision', nullable: true })
  askChangePct: number | null;

  /** Composite 0-100 heat score (blend of the above; improves with history). */
  @Column({ type: 'int', nullable: true })
  heatScore: number | null;

  /** The eBay query used for this segment's sample. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sampleQuery: string | null;

  /** Room for future signals (social buzz, first-party saves, …). */
  @Column({ type: 'jsonb', nullable: true })
  extra: Record<string, unknown> | null;
}
