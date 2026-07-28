import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A backgrounded "deep dive" — a heavyweight, multi-source predictive research
 * brief for a card/player/set requested from the Insights chat (or a button).
 * Runs async so the chat stays fast; the result lands here and surfaces in the
 * Deep Dives panel.
 */
@Entity('deep_research_jobs')
export class DeepResearchJob extends BaseEntity {
  @Column({ type: 'varchar', length: 300 })
  subject: string;

  /** 'pending' | 'running' | 'done' | 'error'. */
  @Index()
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  /**
   * The depth this dive was RUN at ('quick' | 'balanced' | 'deep').
   *
   * Persisted so the reuse cache can compare depths — without it a Brief
   * report was handed back to someone asking for a Deep one, which made the
   * depth setting look like it did nothing. Null on rows written before this
   * existed; treated as 'balanced' (the default) when ranking.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  depth: string | null;

  /** The structured forecast brief (CardForecastData) once done. */
  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  /** A reference image of the confirmed card, shown atop the report. */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  imageUrl: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'uuid', nullable: true })
  requestedByAdminId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
