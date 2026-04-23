import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { PrizeConfiguration } from './prize-configuration.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A user "watching" an item — i.e. saved it to their watchlist.
 *
 * Watchers receive an in-app inbox message and an email when the item's
 * price changes or when the item sells out.
 */
@Entity('prize_item_watchers')
@Unique('UQ_prize_item_watchers_item_user', ['itemId', 'userId'])
@Index('IDX_prize_item_watchers_user', ['userId'])
@Index('IDX_prize_item_watchers_item', ['itemId'])
export class PrizeItemWatcher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'item_id' })
  itemId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => PrizeConfiguration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item: PrizeConfiguration;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
