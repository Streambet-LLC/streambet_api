import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * Thumbs up/down on a Cardy answer. The labeled dataset behind the reliability
 * flywheel: thumbs-down answers become review items + candidate eval fixtures,
 * so the prompts and rubric improve from real usage.
 */
@Entity('insights_feedback')
export class InsightsFeedback extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 8 })
  rating: 'up' | 'down' | string;

  /** The question that produced the answer (context). */
  @Column({ type: 'text', nullable: true })
  question: string | null;

  /** The answer being rated. */
  @Column({ type: 'text', nullable: true })
  answer: string | null;

  /** Optional free-text note from the admin. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** The card subject, when the answer was about a specific card. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  subject: string | null;

  @Column({ type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column({ type: 'uuid', nullable: true })
  adminId: string | null;
}
