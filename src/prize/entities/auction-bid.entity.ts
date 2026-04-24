import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { Auction } from './auction.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Append-only bid log for an auction. We always insert; we never update or
 * delete a bid row. This gives us a complete audit trail and makes
 * fallback-to-runner-up easy: we just walk the table by amount desc.
 *
 * `amount_usd` is the *visible* bid that resulted from this user action.
 * `proxy_max_usd` is the user's max-willing-to-pay (>= amount_usd) used by
 * the proxy bidding engine. We keep both columns so admin tooling can
 * reconstruct what each user "really" bid.
 *
 * `is_proxy_auto` marks rows the engine inserted on the user's behalf to
 * counter another bidder, so the activity feed can show "auto-bid".
 */
@Entity('auction_bids')
@Index('IDX_auction_bids_auction_amount', ['auctionId', 'amountUsd'])
@Index('IDX_auction_bids_user', ['userId'])
@Index('IDX_auction_bids_auction_created', ['auctionId', 'createdAt'])
export class AuctionBid {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'auction_id' })
  auctionId: string;

  @ManyToOne(() => Auction, (a) => a.bids, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'auction_id' })
  auction: Auction;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'amount_usd' })
  amountUsd: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'proxy_max_usd' })
  proxyMaxUsd: string;

  @Column({ type: 'boolean', name: 'is_proxy_auto', default: false })
  isProxyAuto: boolean;

  /** Snapshot of the saved Stripe PaymentMethod id at bid time. */
  @Column({
    type: 'varchar',
    length: 255,
    name: 'stripe_payment_method_id',
    nullable: true,
  })
  stripePaymentMethodId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
