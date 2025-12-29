import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/users/entities/user.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

@Entity('referral_links')
export class ReferralLink extends BaseEntity {
  @Column({ name: 'user_uuid' })
  userUuid: string;

  @ManyToOne(() => User, (user) => user.id, {})
  @JoinColumn({ name: 'user_uuid' })
  user: User;

  @Column({ name: 'slug' })
  slug: string;

  @Column({ type: 'boolean' })
  is_active: boolean;

  @ManyToOne(() => User, (user) => user.refLink)
  @JoinColumn({
    name: 'slug', // Specifies the actual column name in the 'photo' table
    referencedColumnName: 'refLink', // Refers to the 'id' column in the 'user' table (optional, as 'id' is the default)
  })
  users: User[];
}
