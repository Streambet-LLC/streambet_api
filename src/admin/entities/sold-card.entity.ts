import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A card the user has sold — the realized side of the portfolio. Where
 * `TrackedCard` holds unrealized (live value vs. cost basis), this row is
 * frozen at the moment of sale: what you paid, what it sold for, and the fees
 * you ate. Realized P/L is derived, never stored, so editing any leg keeps the
 * roll-up honest.
 *
 * `trackedCardId` is a soft link back to the watchlist row it came from (null
 * for sales logged directly). It is intentionally NOT a foreign key — untracking
 * a card must not erase your sale history.
 */
@Entity('sold_cards')
export class SoldCard extends BaseEntity {
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

  /** How many copies went in this sale. */
  @Column({ type: 'int', default: 1 })
  quantity: number;

  /** Per-unit cost basis (what you paid), USD. Null = unknown. */
  @Column({ type: 'float', nullable: true })
  costBasisUsd: number | null;

  /** Per-unit gross sale price, USD. */
  @Column({ type: 'float', nullable: true })
  salePriceUsd: number | null;

  /** Total fees for the sale (platform + shipping), USD — not per-unit. */
  @Column({ type: 'float', nullable: true })
  feesUsd: number | null;

  /** Where it sold — eBay, Whatnot, local, etc. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  platform: string | null;

  @Column({ type: 'timestamp', nullable: true })
  soldAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Soft link to the watchlist row this sale came from (no FK by design). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  trackedCardId: string | null;

  /** The user whose portfolio this sale belongs to (null = global/admin). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  ownerUserId: string | null;

  /** Admin who logged it (audit). */
  @Column({ type: 'uuid', nullable: true })
  addedByAdminId: string | null;
}
