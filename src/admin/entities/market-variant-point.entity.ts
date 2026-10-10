import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * One specific card found inside a broader heat topic, at one snapshot — e.g.
 * "2012 #1 Silver · PSA 10" inside "LeBron Prizm". Parsed from the sampled
 * listing titles (see parseVariant), so Spike Radar can see an exact card
 * lighting up without anyone having to track it first.
 */
@Entity('market_variant_points')
@Index('IDX_market_variant_seg_sig_time', [
  'segment',
  'signature',
  'capturedAt',
])
@Index('IDX_market_variant_hot_time', ['hot', 'capturedAt'])
export class MarketVariantPoint extends BaseEntity {
  /** The heat topic it was found in. */
  @Column({ type: 'varchar', length: 64 })
  segment: string;

  /** Grouping key, e.g. "2012|#1|silver|psa 10". */
  @Column({ type: 'varchar', length: 160 })
  signature: string;

  @Column({ type: 'varchar', length: 160 })
  label: string;

  @Column({ type: 'timestamp' })
  capturedAt: Date;

  /** Copies of this card in the topic's sample right now. */
  @Column({ type: 'int', default: 0 })
  listedCount: number;

  @Column({ type: 'double precision', nullable: true })
  floorUsd: number | null;

  @Column({ type: 'double precision', nullable: true })
  medianUsd: number | null;

  /** Of its copies live ~a day earlier, how many are gone now. */
  @Column({ type: 'int', default: 0 })
  clearedCount: number;

  @Column({ type: 'double precision', nullable: true })
  floorChangePct: number | null;

  @Column({ type: 'double precision', nullable: true })
  countChangePct: number | null;

  /** Lighting up (see variantMove). */
  @Column({ type: 'boolean', default: false })
  hot: boolean;

  /** e.g. { queryTerms, sampleTitle, sampleUrl }. */
  @Column({ type: 'jsonb', nullable: true })
  extra: Record<string, unknown> | null;
}
