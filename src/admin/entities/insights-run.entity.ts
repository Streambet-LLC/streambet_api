import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * The in-flight state of ONE chat turn, so a user who navigates away mid-answer
 * can come back and pick it up. The server already finishes and persists the
 * answer after a client disconnect (the SSE writer swallows write errors on
 * purpose) — what was missing was any way for a returning client to learn that
 * a turn is still running and what it has produced so far.
 *
 * This is transient state, NOT history: `insights_exchanges` remains the
 * permanent record. One row per conversation (conversationId is unique), so the
 * table stays bounded — each new turn overwrites the previous run.
 */
@Entity('insights_runs')
export class InsightsRun extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  conversationId: string;

  /** The user turn that kicked this run off, for rebuilding the UI. */
  @Column({ type: 'text' })
  question: string;

  /** running | done | error */
  @Column({ type: 'varchar', length: 20, default: 'running' })
  status: string;

  /** Partial answer while running; the final text once done. */
  @Column({ type: 'text', default: '' })
  answer: string;

  /** Tool names used, once known. */
  @Column({ type: 'jsonb', nullable: true })
  tools: string[] | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /**
   * Explicit start stamp — `createdAt` is not usable here because a row is
   * reused across turns, so it would still hold the FIRST turn's time and
   * every later run would look instantly stale.
   */
  @Column({ type: 'timestamp' })
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  requestedByAdminId: string | null;
}
