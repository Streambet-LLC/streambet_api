import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

export enum ConciergeRequestStatus {
  PENDING = 'pending',
  CLAIMED = 'claimed',
}

@Entity('concierge_requests')
export class ConciergeRequest extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    type: 'enum',
    enum: ConciergeRequestStatus,
    default: ConciergeRequestStatus.PENDING,
  })
  status: ConciergeRequestStatus;

  @Column({ type: 'uuid', name: 'claimed_by', nullable: true })
  claimedBy: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'claimed_by_name',
    nullable: true,
  })
  claimedByName: string | null;

  @Column({ type: 'timestamp', name: 'claimed_at', nullable: true })
  claimedAt: Date | null;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'claimed_by' })
  claimedByUser: User;
}
