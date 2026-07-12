import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * One question → answer exchange from the Insights chat, persisted so admins
 * can browse past insights by date and reopen a conversation. Grouped by
 * `conversationId` (one per chat session); ordered by `createdAt`.
 */
@Entity('insights_exchanges')
export class InsightsExchange extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  conversationId: string;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text' })
  answer: string;

  /** Tool names used to produce the answer (web_search, search_cards, …). */
  @Column({ type: 'jsonb', nullable: true })
  tools: string[] | null;

  @Column({ type: 'uuid', nullable: true })
  requestedByAdminId: string | null;
}
