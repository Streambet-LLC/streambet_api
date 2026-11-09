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
import { AuctionCategory } from '../enums/auction-category.enum';
import { AuctionBid } from './auction-bid.entity';
import type {
  AcceptedPayments,
  AuctionFundingMethod,
  AuctionImage,
  AuctionLengthPreset,
  AuctionVideo,
  EstValueMeta,
  FulfillmentStatus,
  ShippingAddressSnapshot,
} from '../../auctions/hermes.types';

/**
 * A Hermes auction. Hermes auctions are standalone — the item (title,
 * description, category, media) lives on this row. Legacy shop auctions
 * kept a 1:1 link to a `PrizeConfiguration`; that link is now optional.
 *
 * Money fields are stored in USD with 2-decimal precision. The cached
 * `current_bid_usd` / `current_leader_user_id` / `bid_count` / `proxy_max_usd`
 * are maintained transactionally by the auction service; the source of
 * truth is the `auction_bids` table.
 *
 * Anti-snipe (soft close): a bid landing inside the final window
 * (`ANTI_SNIPE_WINDOW_SECONDS`, 2 min) resets `ends_at` to now + window so
 * there is always a full window left to respond (no cap), and increments
 * `extension_count`.
 */
@Entity('auctions')
@Unique('UQ_auctions_prize_configuration_id', ['prizeConfigurationId'])
@Index('IDX_auctions_status_ends_at', ['status', 'endsAt'])
@Index('IDX_auctions_ends_at', ['endsAt'])
@Index('IDX_auctions_status', ['status'])
export class Auction extends BaseEntity {
  @Column({ type: 'uuid', name: 'prize_configuration_id', nullable: true })
  prizeConfigurationId: string | null;

  @OneToOne(() => PrizeConfiguration, (p) => p.auction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prize_configuration_id' })
  prizeConfiguration: PrizeConfiguration | null;

  @Column({ type: 'varchar', length: 200, name: 'title', nullable: true })
  title: string | null;

  @Column({ type: 'text', name: 'description', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: AuctionCategory,
    enumName: 'auction_category_enum',
    name: 'category',
    nullable: true,
  })
  category: AuctionCategory | null;

  @Column({ type: 'jsonb', name: 'images', default: () => "'[]'" })
  images: AuctionImage[];

  @Column({ type: 'jsonb', name: 'videos', default: () => "'[]'" })
  videos: AuctionVideo[];

  /** Whole days for preset lengths; null for a custom end. */
  @Column({ type: 'integer', name: 'duration_days', nullable: true })
  durationDays: number | null;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'length_preset',
    nullable: true,
  })
  lengthPreset: AuctionLengthPreset | null;

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

  /** Legacy internal "card value" from shop auctions. Not surfaced to users. */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'card_value_usd',
    nullable: true,
  })
  cardValueUsd: string | null;

  /**
   * Public "Est. Value" shown to bidders: the single value, or the low end of
   * the range when `estValueHighUsd` is set.
   */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'est_value_usd',
    nullable: true,
  })
  estValueUsd: string | null;

  /** Top of the Est. Value range; null = a single value. */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'est_value_high_usd',
    nullable: true,
  })
  estValueHighUsd: string | null;

  /** `manual` (admin typed it) or `pulled` (accepted comp recommendation). */
  @Column({
    type: 'varchar',
    length: 16,
    name: 'est_value_source',
    nullable: true,
  })
  estValueSource: 'manual' | 'pulled' | null;

  @Column({ type: 'jsonb', name: 'est_value_meta', nullable: true })
  estValueMeta: EstValueMeta | null;

  /** When false, Est. Value is hidden from bidders (admins still see it). */
  @Column({ type: 'boolean', name: 'show_est_value', default: true })
  showEstValue: boolean;

  /** Seller shown to bidders; null = the house (Hermes Auctions). */
  @Column({ type: 'varchar', length: 80, name: 'seller_name', nullable: true })
  sellerName: string | null;

  /** Flat shipping the winner pays on top of the hammer price. */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'shipping_usd',
    default: 0,
  })
  shippingUsd: string;

  /**
   * Buyer fee ("premium") on the hammer, in percent, by the tender the winner
   * pays with. Set from `BUYER_PREMIUM_RATES` when a Hermes auction is
   * created and never changed after, so bidders keep the terms they saw.
   * All-in: processing comes out of it. 0 on legacy rows. (The card rate
   * keeps the original single-rate column name, `buyer_premium_percent`.)
   */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'buyer_premium_percent',
    default: 0,
  })
  buyerPremiumCardPercent: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'buyer_premium_ach_percent',
    default: 0,
  })
  buyerPremiumAchPercent: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'buyer_premium_usdc_percent',
    default: 0,
  })
  buyerPremiumUsdcPercent: string;

  @Column({ type: 'boolean', name: 'is_featured', default: false })
  isFeatured: boolean;

  /** Payment rails bidders may use: fiat (card + ACH), crypto (USDC) or both. */
  @Column({
    type: 'varchar',
    length: 8,
    name: 'accepted_payments',
    default: 'both',
  })
  acceptedPayments: AcceptedPayments;

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

  /** PrizeOrder created on successful autopay (legacy shop auctions only). */
  @Column({ type: 'uuid', name: 'prize_order_id', nullable: true })
  prizeOrderId: string | null;

  /** How the winner paid (or is paying): card | ach | usdc. */
  @Column({
    type: 'varchar',
    length: 16,
    name: 'payment_method',
    nullable: true,
  })
  paymentMethod: AuctionFundingMethod | null;

  /**
   * Card processing passed through to card payers. Only wins settled before
   * 2026-11-09 have a non-zero value; since then processing comes out of the
   * buyer premium and this is always 0.
   */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'card_fee_usd',
    nullable: true,
  })
  cardFeeUsd: string | null;

  /** Buyer premium charged on the hammer (set with the winner). */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'buyer_premium_usd',
    nullable: true,
  })
  buyerPremiumUsd: string | null;

  /** Hammer + premium + shipping + card fee actually charged / settled. */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'total_charged_usd',
    nullable: true,
  })
  totalChargedUsd: string | null;

  /** Grace deadline for a winner whose charge needs action / failed. */
  @Column({ type: 'timestamptz', name: 'payment_due_at', nullable: true })
  paymentDueAt: Date | null;

  /** Winners whose payment declined — never offered the item again. */
  @Column({
    type: 'uuid',
    array: true,
    name: 'declined_user_ids',
    default: () => "'{}'",
  })
  declinedUserIds: string[];

  @Column({ type: 'jsonb', name: 'shipping_address', nullable: true })
  shippingAddress: ShippingAddressSnapshot | null;

  @Column({
    type: 'varchar',
    length: 24,
    name: 'fulfillment_status',
    default: 'pending',
  })
  fulfillmentStatus: FulfillmentStatus;

  @Column({ type: 'varchar', length: 64, name: 'carrier', nullable: true })
  carrier: string | null;

  @Column({
    type: 'varchar',
    length: 128,
    name: 'tracking_number',
    nullable: true,
  })
  trackingNumber: string | null;

  @Column({ type: 'timestamptz', name: 'shipped_at', nullable: true })
  shippedAt: Date | null;

  /** HermesAuction PDA once opened on-chain (first USDC deposit). */
  @Column({
    type: 'varchar',
    length: 64,
    name: 'onchain_auction',
    nullable: true,
  })
  onchainAuction: string | null;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @OneToMany(() => AuctionBid, (bid) => bid.auction)
  bids: AuctionBid[];
}
