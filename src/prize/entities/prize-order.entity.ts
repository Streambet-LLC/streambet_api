import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { PrizeConfiguration } from './prize-configuration.entity';

/**
 * Entity for tracking prize purchases with combined payment (coins + USD)
 */
@Entity('prize_orders')
export class PrizeOrder extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'prize_configuration_id' })
  prizeConfigurationId: string;

  @Column({
    type: 'jsonb',
    nullable: false,
    name: 'shipping_address',
  })
  shippingAddress: {
    firstName: string;
    lastName: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };

  @Column({
    type: 'varchar',
    length: 20,
    nullable: false,
    name: 'payment_method',
  })
  paymentMethod: 'coins' | 'usd' | 'combined' | 'crypto';

  @Column({
    type: 'integer',
    nullable: false,
    name: 'coins_deducted',
  })
  coinsDeducted: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: false,
    name: 'usd_charged',
  })
  usdCharged: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: false,
    name: 'total_price',
  })
  totalPrice: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    name: 'offer_amount',
  })
  offerAmount?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    name: 'counter_offer_amount',
  })
  counterOfferAmount?: number;

  @Column({
    type: 'text',
    nullable: true,
    name: 'offer_notes',
  })
  offerNotes?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_session_id',
  })
  stripeSessionId?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_payment_intent_id',
  })
  stripePaymentIntentId?: string;

  /**
   * Stripe Checkout payment_method_types the buyer locked in when this
   * order was created (buy-now) or when their offer was submitted.
   * `null` for coin-only or crypto orders. Used at offer-acceptance
   * time to compute the buyer fee at the correct rate (card = 3%,
   * us_bank_account = 0.8%) and to restrict the hosted Checkout
   * session to that single method so the rate the buyer was quoted
   * is the rate they're actually charged.
   */
  @Column({
    type: 'varchar',
    length: 32,
    nullable: true,
    name: 'stripe_payment_method',
  })
  stripePaymentMethod?: 'card' | 'us_bank_account' | null;

  @Column({
    type: 'varchar',
    length: 25,
    default: 'pending',
    name: 'status',
  })
  status:
    | 'pending'
    | 'buy_attempted'
    | 'payment_processing'
    | 'payment_failed'
    | 'paid'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'offer_made'
    | 'countered'
    | 'rejected'
    | 'offer_accepted';

  /**
   * High-level order type for admin visibility (distinct from `status`,
   * which is the payment/fulfilment state). 'single' = one-item purchase,
   * 'cart' = multi-item cart checkout, 'bundle_offer' = multi-item offer,
   * 'offer' = single-item make-an-offer.
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: 'single',
    name: 'order_type',
  })
  orderType: 'single' | 'cart' | 'bundle_offer' | 'offer';

  /**
   * Shared id linking orders created together (a cart checkout group or a
   * bundle-offer group). Null for standalone single orders.
   */
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'order_group_id',
  })
  orderGroupId?: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'tracking_number',
  })
  trackingNumber?: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'shipping_carrier',
  })
  shippingCarrier?: string;

  @Column({
    type: 'timestamp',
    nullable: true,
    name: 'shipped_at',
  })
  shippedAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
    name: 'last_reminder_sent_at',
  })
  lastReminderSentAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
    name: 'review_reminder_sent_at',
  })
  reviewReminderSentAt?: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => PrizeConfiguration)
  @JoinColumn({ name: 'prize_configuration_id' })
  prizeConfiguration: PrizeConfiguration;

  /**
   * Solana transaction signature for crypto payments (pay_invoice).
   * Used to verify the on-chain transaction before marking order paid.
   */
  @Column({
    type: 'varchar',
    length: 88,
    nullable: true,
    name: 'crypto_tx_signature',
  })
  cryptoTxSignature?: string;

  /**
   * Buyer's Solana wallet address (base58 public key) for crypto payments.
   * Stored for audit trail and to match against buyer account in transaction.
   */
  @Column({
    type: 'varchar',
    length: 88,
    nullable: true,
    name: 'crypto_buyer_wallet',
  })
  cryptoBuyerWallet?: string;

  /**
   * Invoice ID (16 bytes hex-encoded) for replay protection.
   * On-chain pay_invoice uses this to generate the Invoice PDA seed.
   */
  @Column({
    type: 'bytea',
    nullable: true,
    name: 'crypto_invoice_id',
  })
  cryptoInvoiceId?: Buffer;
}
