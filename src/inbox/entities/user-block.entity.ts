import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_blocks')
@Unique(['blockerId', 'blockedId'])
export class UserBlock extends BaseEntity {
  @Column({ type: 'uuid', name: 'blocker_id' })
  blockerId: string;

  @Column({ type: 'uuid', name: 'blocked_id' })
  blockedId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'blocker_id' })
  blocker: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'blocked_id' })
  blocked: User;
}
