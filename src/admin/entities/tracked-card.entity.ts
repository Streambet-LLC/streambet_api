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

  /** Future: the user whose profile this card is saved to (null = global/admin). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  ownerUserId: string | null;

  /** Admin who added it (audit). */
  @Column({ type: 'uuid', nullable: true })
  addedByAdminId: string | null;
}
