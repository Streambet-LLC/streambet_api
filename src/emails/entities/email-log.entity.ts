import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * Audit row written for every transactional email send attempt (via
 * `EmailsService.sendEmailSMTP`). Stores the full payload so an admin can
 * **replay** the exact email, and links to an order (when the params carry an
 * `orderId`) so the admin UI can show a per-order email history.
 */
@Entity('email_logs')
export class EmailLog extends BaseEntity {
  /** Template key, e.g. `seller_shop_purchase`, `offer_countered`. */
  @Column({ type: 'varchar', length: 64, name: 'email_type' })
  emailType: string;

  /** Comma-separated recipient address(es). */
  @Column({ type: 'text', name: 'to_address' })
  toAddress: string;

  @Column({ type: 'text', nullable: true })
  subject: string | null;

  /** The payload params used to render the email — enables replay. */
  @Column({ type: 'jsonb', nullable: true })
  params: Record<string, unknown> | null;

  /** Order this email relates to (from params.orderId), for per-order history. */
  @Index()
  @Column({ type: 'uuid', nullable: true, name: 'related_order_id' })
  relatedOrderId: string | null;

  /** 'sent' | 'failed' | 'suppressed' (waitlist mode — intentionally not sent). */
  @Column({ type: 'varchar', length: 16 })
  status: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Provider message id returned by nodemailer on success. */
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'message_id' })
  messageId: string | null;
}
