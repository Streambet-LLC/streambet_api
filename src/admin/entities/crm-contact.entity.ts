import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A manually-logged buyer or seller in the CRM — the human relationship layer
 * on top of the auto-discovered leads pool. Created either by hand or by
 * converting a discovered lead into a tracked contact.
 */
@Entity('crm_contacts')
export class CrmContact extends BaseEntity {
  /** 'buyer' | 'seller'. */
  @Index()
  @Column({ type: 'varchar', length: 16 })
  kind: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Social handle / username (reddit u/…, bluesky handle, IG, etc.). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  handle: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  company: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  location: string | null;

  /** Where this contact came from: 'manual' | 'lead' | a source name. */
  @Column({ type: 'varchar', length: 32, default: 'manual' })
  source: string;

  /** Pipeline stage: 'new' | 'contacted' | 'negotiating' | 'active' | 'archived'. */
  @Index()
  @Column({ type: 'varchar', length: 24, default: 'new' })
  stage: string;

  /** Starred / preferred buyer or seller. */
  @Index()
  @Column({ type: 'boolean', default: false })
  preferred: boolean;

  /** Free-form tags. */
  @Column({ type: 'jsonb', nullable: true })
  tags: string[] | null;

  /** Cards / players / sets / categories this contact is interested in. */
  @Column({ type: 'jsonb', nullable: true })
  interests: string[] | null;

  /** The discovered_lead this contact was converted from, if any. */
  @Column({ type: 'uuid', nullable: true })
  leadId: string | null;

  /** Admin who created this contact. */
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;
}
