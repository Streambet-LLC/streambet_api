import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/users/entities/user.entity';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

@Entity('followers')
export class Follower extends BaseEntity {
  @Column({ name: 'followed_uuid' })
  followedUuid: string;

  @ManyToOne(() => User, (user) => user.id, {})
  @JoinColumn({ name: 'followed_uuid' })
  followed: User;

  @Column({ name: 'follower_uuid' })
  followerUuid: string;

  @ManyToOne(() => User, (user) => user.id, {})
  @JoinColumn({ name: 'follower_uuid' })
  follower: User;
}
