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
import { Auction } from './auction.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A user watching a Hermes auction (their watchlist). Watchers who haven't
 * bid get the lot's "bidding is open", "closing in 1 hour" and result emails;
 * bidders already get their own versions of those.
 */
@Entity('auction_watchers')
@Unique('UQ_auction_watchers_auction_user', ['auctionId', 'userId'])
@Index('IDX_auction_watchers_user', ['userId'])
export class AuctionWatcher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'auction_id' })
  auctionId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Auction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'auction_id' })
  auction: Auction;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
