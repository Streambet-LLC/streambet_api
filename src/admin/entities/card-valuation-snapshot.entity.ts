import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A point-in-time valuation of a card, logged every time value_card runs.
 * Turns ephemeral web research into a compounding asset: a per-card price
 * history (for charts + trend), cheaper repeats, and — over time — our own
 * proprietary indices built from what we've actually valued.
 */
@Entity('card_valuation_snapshots')
@Index(['subjectKey', 'createdAt'])
export class CardValuationSnapshot extends BaseEntity {
  /** Normalized subject (lowercased) — the series key. */
  @Index()
  @Column({ type: 'varchar', length: 300 })
  subjectKey: string;

  /** The subject as searched (display). */
  @Column({ type: 'varchar', length: 300 })
  subject: string;

  @Column({ type: 'float', nullable: true })
  pointUsd: number | null;

  @Column({ type: 'float', nullable: true })
  lowUsd: number | null;

  @Column({ type: 'float', nullable: true })
  highUsd: number | null;

  @Column({ type: 'int', nullable: true })
  confidencePct: number | null;

  /** anchor-and-adjust | recent-median | triangulation */
  @Column({ type: 'varchar', length: 40, nullable: true })
  method: string | null;

  /** grounded | thin | unverified */
  @Column({ type: 'varchar', length: 20, nullable: true })
  reliability: string | null;

  /** Full CardValuation snapshot (comps, sources, etc.). */
  @Column({ type: 'jsonb', nullable: true })
  valuation: Record<string, unknown> | null;
}
