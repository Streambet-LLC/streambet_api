import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A daily snapshot of FIRST-PARTY engagement (our own platform's views + saves)
 * rolled up to a taxonomy node — market, sub-category, set, or player/character.
 * Unlike the eBay heat points (external market temperature), these measure OUR
 * audience's attention, and are charted over time to reveal peaks and troughs.
 *
 * `segment` is the taxonomy node key (matching `market_taxonomy.key` and the
 * heat points' `segment`), so heat and engagement line up on the same markets.
 */
@Entity('market_engagement_points')
@Index('IDX_market_engagement_seg_time', ['segment', 'capturedAt'])
@Index('IDX_market_engagement_scope', ['scope'])
export class MarketEngagementPoint extends BaseEntity {
  @Column({ type: 'varchar', length: 64 })
  segment: string;

  @Column({ type: 'varchar', length: 24, default: 'segment' })
  scope: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  label: string | null;

  @Column({ type: 'timestamp' })
  capturedAt: Date;

  /** Shop items attributed to this node. */
  @Column({ type: 'int', default: 0 })
  itemCount: number;

  /** Cumulative distinct-viewer views across those items. */
  @Column({ type: 'int', default: 0 })
  totalViews: number;

  /** Users currently watching (saving) those items. */
  @Column({ type: 'int', default: 0 })
  totalWatchers: number;

  /** Distinct-viewer views in the trailing 7 days (attention velocity). */
  @Column({ type: 'int', default: 0 })
  newViews7d: number;

  /** Watchers added in the trailing 7 days. */
  @Column({ type: 'int', default: 0 })
  newWatchers7d: number;

  /** % change in cumulative views vs. the prior snapshot. */
  @Column({ type: 'float', nullable: true })
  viewsChangePct: number | null;

  /** % change in watchers vs. the prior snapshot. */
  @Column({ type: 'float', nullable: true })
  watchersChangePct: number | null;

  @Column({ type: 'jsonb', nullable: true })
  extra: Record<string, unknown> | null;
}
