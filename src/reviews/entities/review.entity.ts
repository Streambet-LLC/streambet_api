import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  Check,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { PrizeOrder } from '../../prize/entities/prize-order.entity';

export type ReviewerRole = 'buyer' | 'seller';

/**
 * Review left by a buyer about a seller, or by a seller about a buyer,
 * tied to a single PrizeOrder. Each user can leave at most one review per
 * order (so for each order there are up to two reviews: one buyer->seller,
 * one seller->buyer).
 */
@Entity('reviews')
@Unique('UQ_reviews_order_reviewer', ['orderId', 'reviewerId'])
@Check('CHK_reviews_rating_range', '"rating" >= 1 AND "rating" <= 5')
@Index('IDX_reviews_reviewee', ['revieweeId'])
@Index('IDX_reviews_reviewer', ['reviewerId'])
@Index('IDX_reviews_order', ['orderId'])
export class Review extends BaseEntity {
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @Column({ type: 'uuid', name: 'reviewer_id' })
  reviewerId: string;

  @Column({ type: 'uuid', name: 'reviewee_id' })
  revieweeId: string;

  /**
   * Side the reviewer was on for this order. 'buyer' means the reviewer was
   * the buyer (and is reviewing the seller). 'seller' means the reviewer was
   * the seller (and is reviewing the buyer).
   */
  @Column({
    type: 'varchar',
    length: 10,
    name: 'reviewer_role',
  })
  reviewerRole: ReviewerRole;

  @Column({ type: 'integer', name: 'rating' })
  rating: number;

  @Column({ type: 'text', name: 'comment', default: '' })
  comment: string;

  @ManyToOne(() => PrizeOrder)
  @JoinColumn({ name: 'order_id' })
  order: PrizeOrder;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reviewer_id' })
  reviewer: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reviewee_id' })
  reviewee: User;
}
