import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index, Unique } from 'typeorm';

/**
 * A normalized external signal about a collector — a social handle, a public
 * profile fact, or an activity datapoint — gathered by a {@link SocialConnector}.
 *
 * COMPLIANCE: only populated from sources we're allowed to use — handles a
 * user/seller consented to give us, our own eBay official-API data, or a
 * licensed vendor. No scraped/non-consented PII.
 *
 * `userId` is the CardCade user this signal belongs to, or null when the
 * signal isn't yet linked to an account (reconciliation candidate).
 */
@Entity('external_signals')
@Unique('UQ_external_signal', ['userId', 'platform', 'handle', 'source'])
export class ExternalSignal extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /** Platform vocabulary: instagram | twitter | tiktok | youtube | ebay | … */
  @Index()
  @Column({ type: 'varchar', length: 32 })
  platform: string;

  /** The @handle / username on that platform. */
  @Column({ type: 'text' })
  handle: string;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  /** Provenance: 'consented' | 'ebay_api' | 'vendor'. Drives trust + compliance. */
  @Column({ type: 'varchar', length: 32, default: 'consented' })
  source: string;

  /** What the signal is: 'handle' | 'profile' | 'activity'. */
  @Column({ type: 'varchar', length: 32, default: 'handle' })
  signalType: string;

  /** Optional admin/connector label ("Personal", "Shop"). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  label: string | null;

  /** Raw enrichment payload (follower counts, bio, etc.) when available. */
  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, unknown> | null;

  /**
   * Reconciliation confidence 0–100 when this signal was linked to the user
   * by inference rather than direct consent; null for consented links.
   */
  @Column({ type: 'int', nullable: true })
  confidence: number | null;

  @Index()
  @Column({ type: 'timestamp', nullable: true })
  collectedAt: Date | null;
}
