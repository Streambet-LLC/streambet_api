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
  paymentMethod: 'coins' | 'usd' | 'combined';

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

  @Column({
    type: 'varchar',
    length: 20,
    default: 'pending',
    name: 'status',
  })
  status:
    | 'pending'
    | 'started'
    | 'paid'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'offer_made'
    | 'countered'
    | 'rejected'
    | 'offer_accepted';

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => PrizeConfiguration)
  @JoinColumn({ name: 'prize_configuration_id' })
  prizeConfiguration: PrizeConfiguration;
}
