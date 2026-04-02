import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import {
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../enums/subscription-plan.enum';

@Entity('subscriptions')
export class Subscription extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    type: 'enum',
    enum: SubscriptionPlan,
    name: 'plan',
  })
  plan: SubscriptionPlan;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    name: 'status',
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'stripe_subscription_id',
    unique: true,
  })
  stripeSubscriptionId: string;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'stripe_customer_id',
  })
  stripeCustomerId: string;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'stripe_price_id',
    nullable: true,
  })
  stripePriceId: string;

  @Column({ type: 'timestamp', name: 'current_period_start', nullable: true })
  currentPeriodStart: Date;

  @Column({ type: 'timestamp', name: 'current_period_end', nullable: true })
  currentPeriodEnd: Date;

  @Column({ type: 'timestamp', name: 'cancelled_at', nullable: true })
  cancelledAt: Date;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
