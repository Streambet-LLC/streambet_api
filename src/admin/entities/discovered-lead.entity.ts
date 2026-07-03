import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index, Unique } from 'typeorm';

/**
 * A lead surfaced by the Discover engine (Reddit / Bluesky / YouTube / Twitch /
 * web) and persisted into a growing pool. Every discovery search upserts its
 * results here (deduped by source + externalId) so the Leads dashboard shows
 * everything we've pulled over time — not just what was manually saved.
 */
@Entity('discovered_leads')
@Unique('UQ_discovered_lead', ['source', 'externalId'])
export class DiscoveredLead extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 32 })
  source: string;

  /** The lead's stable id on its source (post id, comment id, channel id, url). */
  @Column({ type: 'text' })
  externalId: string;

  @Column({ type: 'varchar', length: 255 })
  author: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  authorDisplay: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  community: string | null;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', default: '' })
  text: string;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ type: 'int', nullable: true })
  upvotes: number | null;

  @Column({ type: 'int', nullable: true })
  comments: number | null;

  @Column({ type: 'int', nullable: true })
  reposts: number | null;

  @Column({ type: 'timestamp', nullable: true })
  postedAt: Date | null;

  /** The search query that first surfaced this lead. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  query: string | null;

  /** 'new' | 'added' | 'dismissed'. */
  @Index()
  @Column({ type: 'varchar', length: 16, default: 'new' })
  status: string;

  /** When converted to a prospect, the created user id. */
  @Column({ type: 'uuid', nullable: true })
  convertedUserId: string | null;

  /** Last time a search re-surfaced this lead. */
  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  // --- Claude qualification (buy-likelihood) ---

  /** 0–100 likelihood this person is a genuine card buyer. Null = unqualified. */
  @Index()
  @Column({ type: 'int', nullable: true })
  buyerScore: number | null;

  /** 'buying' | 'selling' | 'showcase' | 'discussion' | 'off_topic'. */
  @Column({ type: 'varchar', length: 24, nullable: true })
  intent: string | null;

  /** Specific cards/players/sets/categories the lead expressed interest in. */
  @Column({ type: 'jsonb', nullable: true })
  interests: string[] | null;

  /** One-line rationale for the score. */
  @Column({ type: 'text', nullable: true })
  qualifyReasoning: string | null;

  @Column({ type: 'timestamp', nullable: true })
  qualifiedAt: Date | null;
}
