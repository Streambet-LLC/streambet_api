import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('creator_applications')
export class CreatorApplication extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  firstName: string;

  @Column({ type: 'varchar', length: 255 })
  lastName: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 50, default: 'creator', name: 'application_type' })
  applicationType: string;

  // Creator-specific fields (nullable)
  @Column({ type: 'text', nullable: true })
  socials: string;

  @Column({ type: 'text', nullable: true })
  message: string;

  // Seller-specific fields (nullable)
  @Column({ type: 'text', nullable: true, name: 'collector_background' })
  collectorBackground: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'city_state' })
  cityState: string;

  @Column({ type: 'text', nullable: true, name: 'cards_collected' })
  cardsCollected: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'card_preference' })
  cardPreference: string;

  @Column({ type: 'varchar', length: 50, default: 'pending', name: 'application_status' })
  applicationStatus: string;

  @Column({ type: 'timestamp', nullable: true, name: 'reviewed_at' })
  reviewedAt: Date;

  @Column({ type: 'varchar', nullable: true, name: 'reviewed_by_user_id' })
  reviewedByUserId: string;

  @Column({ default: false, name: 'is_deleted', type: 'boolean' })
  isDeleted: boolean;
}
