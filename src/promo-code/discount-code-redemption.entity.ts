import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { User } from '../users/entities/user.entity';
import { PromoCode } from './promo-code.entity';

@Entity('discount_code_redemptions')
@Unique(['discountCodeId', 'userId'])
export class DiscountCodeRedemption extends BaseEntity {
  @Column({ type: 'uuid', name: 'discount_code_id' })
  discountCodeId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    type: 'integer',
    name: 'discount_cents',
    comment: 'Discount amount applied in cents',
  })
  discountCents: number;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_session_id',
    comment: 'Stripe session where the discount code was used',
  })
  stripeSessionId?: string;

  @ManyToOne(() => PromoCode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'discount_code_id' })
  discountCode: PromoCode;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
