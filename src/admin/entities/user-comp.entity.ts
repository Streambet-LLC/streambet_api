import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A sale the USER told us about, because our research missed it.
 *
 * Our retrieval only reads what it can find (PSA APR for graded cards, eBay
 * solds for liquid ones). Sales on Goldin, Fanatics, Heritage, PWCC, or a
 * private deal are invisible to it — and the person holding the card usually
 * knows about them. This is how that knowledge gets in and STAYS in: every
 * later valuation of the same subject merges these back in, so a comp only has
 * to be supplied once.
 *
 * Kept in its own table rather than mixed into tracked_cards because a comp is
 * evidence about a CARD (by subject string), not about one person's holding —
 * two users tracking the same card should both benefit.
 */
@Entity('user_comps')
export class UserComp extends BaseEntity {
  /**
   * Normalized card subject (lowercased), matching the valuation cache key so
   * a comp added for "2019 Prizm Color Blast Mahomes PSA 10" is found again on
   * the next valuation of that exact subject.
   */
  @Index()
  @Column({ type: 'varchar', length: 300 })
  subject: string;

  /** The sale's own title as it appears on the page, when known. */
  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'float' })
  priceUsd: number;

  /** YYYY-MM-DD. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  saleDate: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  grade: string | null;

  /** auction-sale | private-sale | marketplace-listing | … */
  @Column({ type: 'varchar', length: 50, default: 'auction-sale' })
  sourceType: string;

  /** Where the sale is published. Required — a comp without a source is a rumour. */
  @Column({ type: 'text' })
  url: string;

  /** Why they added it, in their words. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  /**
   * Whether we have independently confirmed the page shows this sale. False
   * means "the user asserted it" — still usable, but labelled as such so a
   * mistaken or optimistic entry can never masquerade as retrieved evidence.
   */
  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @Column({ type: 'uuid', nullable: true })
  addedByAdminId: string | null;
}
