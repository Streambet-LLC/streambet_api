import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { PrizeConfiguration } from './prize-configuration.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Raw record of a single item-view event.
 *
 * One row is inserted at most once per (item, viewer, day) thanks to the
 * partial unique indexes created in the migration. This both supports
 * analytics and lets us recompute the cached `viewCount` on
 * PrizeConfiguration if needed.
 *
 * For anonymous viewers, the client sends a stable random id in the
 * `x-anon-id` header (also stored in a long-lived cookie) which we record
 * in `anonId`. Logged-in users use `userId`.
 */
@Entity('prize_item_views')
@Index('IDX_prize_item_views_item', ['itemId'])
@Index('IDX_prize_item_views_user', ['userId'])
@Index('IDX_prize_item_views_anon', ['anonId'])
export class PrizeItemView {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'item_id' })
  itemId: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'anon_id', nullable: true })
  anonId: string | null;

  /**
   * UTC date (date-only) the view was bucketed under for dedupe.
   * The migration creates partial unique indexes on
   * (item_id, user_id, viewed_on) and (item_id, anon_id, viewed_on).
   */
  @Column({ type: 'date', name: 'viewed_on' })
  viewedOn: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => PrizeConfiguration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item: PrizeConfiguration;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;
}
