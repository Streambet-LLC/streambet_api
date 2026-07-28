import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A card being tracked for market analysis — the research universe that
 * forecasts, market profiles, and deep dives key off (replacing the old
 * marketplace catalog as the card source).
 *
 * `ownerUserId` is null for admin/global tracked cards today; when user
 * accounts open up post-waitlist, each user's saved cards land here with
 * their id, powering per-user watchlists with the same machinery.
 */
@Entity('tracked_cards')
export class TrackedCard extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 300 })
  name: string;

  /** e.g. 'pokemon' | 'one_piece' | 'sports' | 'other' (free-form). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  brand: string | null;

  /** e.g. 'raw' | 'slab' | 'sealed' | 'other' (free-form). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  category: string | null;

  /** e.g. 'PSA 10', 'BGS 9.5' — null for raw. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  grade: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // ---- Portfolio holding fields ----

  /**
   * Do they actually own this, or are they only watching it?
   *
   * Both live in this table, so this flag is the ONLY thing separating the
   * watchlist from holdings — without it every watched card counts toward
   * portfolio value. Cost basis can't stand in for it: you can own a card and
   * not remember what you paid.
   */
  @Index()
  @Column({ type: 'boolean', default: false })
  owned: boolean;

  /** How many copies held. */
  @Column({ type: 'int', default: 1 })
  quantity: number;

  /** Per-unit cost basis (what you paid), USD. Null = watch-only. */
  @Column({ type: 'float', nullable: true })
  costBasisUsd: number | null;

  /** When it was acquired. */
  @Column({ type: 'timestamp', nullable: true })
  acquiredAt: Date | null;

  // ---- Cached latest valuation (from value_card) for the portfolio view ----

  /** Latest per-unit market value, USD. */
  @Column({ type: 'float', nullable: true })
  lastValueUsd: number | null;

  @Column({ type: 'int', nullable: true })
  lastConfidencePct: number | null;

  @Column({ type: 'timestamp', nullable: true })
  lastValuedAt: Date | null;

  /** Full CardValuation snapshot for the card display. */
  @Column({ type: 'jsonb', nullable: true })
  lastValuation: Record<string, unknown> | null;

  // ---- Price alerts (notify when value crosses a target) ----

  /** Alert when value rises to/above this (USD). */
  @Column({ type: 'float', nullable: true })
  alertAboveUsd: number | null;

  /** Alert when value falls to/below this (USD). */
  @Column({ type: 'float', nullable: true })
  alertBelowUsd: number | null;

  /** Future: the user whose profile this card is saved to (null = global/admin). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  ownerUserId: string | null;

  /** Admin who added it (audit). */
  @Column({ type: 'uuid', nullable: true })
  addedByAdminId: string | null;
}
