import { BaseEntity } from '../../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * One row per user-facing AI operation (a chat message, a deep dive, a market
 * refresh, …). Token counts come straight from the Anthropic response `usage`
 * object, accumulated across every API round-trip that operation made; `costUsd`
 * is our estimate from those tokens. Powers the admin Usage tab.
 */
@Entity('claude_usage_logs')
export class ClaudeUsageLog extends BaseEntity {
  /** Prompt type — e.g. 'chat', 'deep_dive', 'card_forecast', 'market_refresh'. */
  @Index()
  @Column({ type: 'varchar', length: 40 })
  feature: string;

  /** Admin who triggered it; null for system/background work (e.g. cron). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  adminId: string | null;

  /** Model used, e.g. 'claude-opus-4-8'. */
  @Column({ type: 'varchar', length: 48 })
  model: string;

  @Column({ type: 'integer', default: 0 })
  inputTokens: number;

  @Column({ type: 'integer', default: 0 })
  outputTokens: number;

  /** Tokens served from the prompt cache (billed ~0.1x input). */
  @Column({ type: 'integer', default: 0 })
  cacheReadTokens: number;

  /** Tokens written to the prompt cache (billed ~1.25x input). */
  @Column({ type: 'integer', default: 0 })
  cacheWriteTokens: number;

  /** Server-side web_search requests made during the operation. */
  @Column({ type: 'integer', default: 0 })
  webSearches: number;

  /** Estimated USD cost of this operation. */
  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd: string;
}
