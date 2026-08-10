import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A timeline note attached to either a CRM contact or a discovered lead
 * (exactly one of contactId / leadId is set).
 */
@Entity('crm_notes')
export class CrmNote extends BaseEntity {
  /** The contact this note belongs to (null for lead notes). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  contactId: string | null;

  /** The discovered_lead this note belongs to (null for contact notes). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  leadId: string | null;

  @Column({ type: 'text' })
  body: string;

  /** Admin who wrote the note. */
  @Column({ type: 'uuid', nullable: true })
  authorId: string | null;
}
