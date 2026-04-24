import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  OneToOne,
  Index,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { PrizeConfiguration } from './prize-configuration.entity';
import { User } from '../../users/entities/user.entity';
import { AuctionStatus } from '../enums/auction-status.enum';
import { AuctionBid } from './auction-bid.entity';

/**
 * One auction per `PrizeConfiguration` (the "item"). The link is unique:
 * an item can only have a single auction at a time. When admins create a
 * follow-up auction on the same physical card they create a new
 * PrizeConfiguration row first (existing data-hardening pattern).
 *
 * Money fields are stored in USD with 2-decimal precision. The cached
 * `current_bid_usd` / `current_leader_user_id` / `bid_count` / `proxy_max_usd`
 * are maintained transactionally by the auction service; the source of
 * truth is the `auction_bids` table.
 *
 * Anti-snipe: when a bid lands within the last 30 seconds of `ends_at`
 * the service extends `ends_at` by 30 seconds and increments
 * `extension_count` (no cap).
 */
@Entity('auctions')
@Unique('UQ_auctions_prize_configuration_id', ['prizeConfigurationId'])
@Index('IDX_auctions_status_ends_at', ['status', 'endsAt'])
@Index('IDX_auctions_ends_at', ['endsAt'])
@Index('IDX_auctions_status', ['status'])
export class Auction extends BaseEntity {
  @Column({ type: 'uuid', name: 'prize_configuration_id' })
  prizeConfigurationId: string;

  @OneToOne(() => PrizeConfiguration, (p) => p.auction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prize_configuration_id' })
  prizeConfiguration: PrizeConfiguration;

  @Column({ type: 'integer', name: 'duration_days' })
  durationDays: number; // 1 | 3 | 5 | 7 (validated in DTO)

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt: Date;

  @Column({ type: 'timestamptz', name: 'ends_at' })
  endsAt: Date;

  @Column({
    type: 'enum',
    enum: AuctionStatus,
    name: 'status',
    default: AuctionStatus.SCHEDULED,
  })
  status: AuctionStatus;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'starting_price_usd',
  })
  startingPriceUsd: string; // numeric → string in TypeORM

  /** Optional reserve. Hidden from bidders; admins see "met" / "not met". */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'reserve_price_usd',
    nullable: true,
  })
  reservePriceUsd: string | null;

  /** Internal "card value" admins record at setup. Not surfaced to users. */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'card_value_usd',
    nullable: true,
  })
  cardValueUsd: string | null;

  /** Current displayed high bid. Null until the first bid. */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'current_bid_usd',
    nullable: true,
  })
  currentBidUsd: string | null;

  @Column({ type: 'uuid', name: 'current_leader_user_id', nullable: true })
  currentLeaderUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'current_leader_user_id' })
  currentLeader: User | null;

  /**
   * Highest known proxy max from the current leader. Used by the proxy
   * bidding engine to auto-counter the next challenger up to this amount.
   */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'proxy_max_usd',
    nullable: true,
  })
  proxyMaxUsd: string | null;

  @Column({ type: 'integer', name: 'bid_count', default: 0 })
  bidCount: number;

  @Column({ type: 'integer', name: 'extension_count', default: 0 })
  extensionCount: number;

  /** Set on close once a winner is determined (may differ from currentLeader if fallback). */
  @Column({ type: 'uuid', name: 'winner_user_id', nullable: true })
  winnerUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'winner_user_id' })
  winner: User | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'winning_amount_usd',
    nullable: true,
  })
  winningAmountUsd: string | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt: Date | null;

  /** Stripe PaymentIntent id for the autopay charge. */
  @Column({
    type: 'varchar',
    length: 255,
    name: 'payment_intent_id',
    nullable: true,
  })
  paymentIntentId: string | null;

  /** PrizeOrder created on successful autopay (links to existing fulfillment flow). */
  @Column({ type: 'uuid', name: 'prize_order_id', nullable: true })
  prizeOrderId: string | null;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @OneToMany(() => AuctionBid, (bid) => bid.auction)
  bids: AuctionBid[];
}
