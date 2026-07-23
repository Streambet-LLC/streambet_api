import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A public waitlist signup captured on the landing page while the product is in
 * private testing. Email is unique (case-insensitive at the service layer) so a
 * repeat signup is a no-op rather than a duplicate.
 */
@Entity('waitlist_signups')
export class WaitlistSignup extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320 })
  email: string;

  /** Optional name the visitor supplied. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  name: string | null;

  /** Where the signup came from (utm/source/referrer), best-effort. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  source: string | null;

  /** Best-effort request IP, for basic abuse/dedup insight. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;
}
