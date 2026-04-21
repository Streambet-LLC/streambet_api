import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Review, ReviewerRole } from './entities/review.entity';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import { User } from '../users/entities/user.entity';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.requests.dto';
import {
  ListReviewsQueryDto,
  ReviewListRoleFilter,
  ReviewListSort,
} from './dto/list-reviews.dto';

const HOURS_BEFORE_REVIEW_ALLOWED = 24;
const DAYS_EDITABLE = 7;
const DAYS_DELETABLE = 14;

const PAID_LIKE_STATUSES: PrizeOrder['status'][] = [
  'paid',
  'processing',
  'shipped',
  'delivered',
];

export type SerializedReview = {
  id: string;
  orderId: string;
  rating: number;
  comment: string;
  reviewerRole: ReviewerRole;
  createdAt: Date;
  updatedAt: Date;
  canEdit: boolean;
  canDelete: boolean;
  reviewer: PublicUserSummary;
  reviewee: PublicUserSummary;
  itemName?: string | null;
};

export type PublicUserSummary = {
  id: string;
  username: string;
  name: string | null;
  profileImageUrl: string | null;
};

export type ReviewStats = {
  asBuyer: { average: number; count: number };
  asSeller: { average: number; count: number };
};

export type ReviewableOrderSide = {
  orderId: string;
  itemName: string;
  itemImageUrl: string | null;
  purchasedAt: Date;
  shippedAt: Date | null;
  // Counterparty (the user the current viewer would be reviewing)
  counterparty: PublicUserSummary;
  // What side the current viewer was on
  myRole: ReviewerRole;
  existingReview: SerializedReview | null;
  // Window state
  reviewableAt: Date;
  isReviewable: boolean;
};

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectRepository(Review)
    private readonly reviewsRepository: Repository<Review>,
    @InjectRepository(PrizeOrder)
    private readonly prizeOrderRepository: Repository<PrizeOrder>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  // ─── Helpers ────────────────────────────────────────────────────────

  private toPublicUser(user: User | null | undefined): PublicUserSummary {
    if (!user) {
      return {
        id: '',
        username: '(deleted)',
        name: null,
        profileImageUrl: null,
      };
    }
    return {
      id: user.id,
      username: user.username,
      name: user.name ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
    };
  }

  private serialize(review: Review, viewerId: string | null): SerializedReview {
    const now = Date.now();
    const createdMs = new Date(review.createdAt).getTime();
    const ageDays = (now - createdMs) / (1000 * 60 * 60 * 24);
    const isOwner = viewerId !== null && viewerId === review.reviewerId;
    return {
      id: review.id,
      orderId: review.orderId,
      rating: review.rating,
      comment: review.comment,
      reviewerRole: review.reviewerRole,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      canEdit: isOwner && ageDays <= DAYS_EDITABLE,
      canDelete: isOwner && ageDays <= DAYS_DELETABLE,
      reviewer: this.toPublicUser(review.reviewer),
      reviewee: this.toPublicUser(review.reviewee),
      itemName: review.order?.prizeConfiguration?.name ?? null,
    };
  }

  /**
   * Loads the order + relations needed to determine the buyer/seller pair.
   * Throws NotFound if the order does not exist.
   */
  private async loadOrderForReview(orderId: string): Promise<PrizeOrder> {
    const order = await this.prizeOrderRepository.findOne({
      where: { id: orderId },
      relations: ['user', 'prizeConfiguration', 'prizeConfiguration.creator'],
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /**
   * Determine the buyer & seller for an order. Returns null for sellerId if
   * no creator (e.g. CardCade-owned items) so we can guard the caller.
   */
  private resolveParties(order: PrizeOrder): {
    buyerId: string;
    sellerId: string | null;
  } {
    const buyerId = order.userId;
    const sellerId = order.prizeConfiguration?.createdBy ?? null;
    return { buyerId, sellerId };
  }

  /**
   * Whether a given order is in a state where reviews are allowed.
   * Reviews require: paid (or further along), payment was at least
   * HOURS_BEFORE_REVIEW_ALLOWED ago, and the order isn't cancelled.
   */
  private isOrderReviewable(order: PrizeOrder): boolean {
    if (!PAID_LIKE_STATUSES.includes(order.status)) return false;
    const ageMs = Date.now() - new Date(order.createdAt).getTime();
    return ageMs >= HOURS_BEFORE_REVIEW_ALLOWED * 60 * 60 * 1000;
  }

  private reviewableAt(order: PrizeOrder): Date {
    return new Date(
      new Date(order.createdAt).getTime() +
        HOURS_BEFORE_REVIEW_ALLOWED * 60 * 60 * 1000,
    );
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * Create a review for an order. The current user must be either the buyer
   * or the seller for the order, and must not already have left a review.
   */
  async createReview(
    userId: string,
    dto: CreateReviewDto,
  ): Promise<SerializedReview> {
    const order = await this.loadOrderForReview(dto.orderId);
    if (!this.isOrderReviewable(order)) {
      throw new BadRequestException(
        'Reviews can be left starting 24 hours after purchase, on completed orders only.',
      );
    }
    const { buyerId, sellerId } = this.resolveParties(order);
    let reviewerRole: ReviewerRole;
    let revieweeId: string;
    if (userId === buyerId) {
      reviewerRole = 'buyer';
      if (!sellerId) {
        throw new BadRequestException('This order has no seller to review.');
      }
      revieweeId = sellerId;
    } else if (sellerId && userId === sellerId) {
      reviewerRole = 'seller';
      revieweeId = buyerId;
    } else {
      throw new ForbiddenException(
        'You can only review orders that you bought or sold.',
      );
    }

    const existing = await this.reviewsRepository.findOne({
      where: { orderId: dto.orderId, reviewerId: userId },
    });
    if (existing) {
      throw new BadRequestException(
        'You have already left a review for this order. You can edit it instead.',
      );
    }

    const review = this.reviewsRepository.create({
      orderId: dto.orderId,
      reviewerId: userId,
      revieweeId,
      reviewerRole,
      rating: dto.rating,
      comment: dto.comment ?? '',
    });
    const saved = await this.reviewsRepository.save(review);
    const reloaded = await this.reviewsRepository.findOne({
      where: { id: saved.id },
      relations: ['reviewer', 'reviewee', 'order', 'order.prizeConfiguration'],
    });
    return this.serialize(reloaded ?? saved, userId);
  }

  async updateReview(
    userId: string,
    reviewId: string,
    dto: UpdateReviewDto,
  ): Promise<SerializedReview> {
    const review = await this.reviewsRepository.findOne({
      where: { id: reviewId },
      relations: ['reviewer', 'reviewee', 'order', 'order.prizeConfiguration'],
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.reviewerId !== userId) {
      throw new ForbiddenException('You can only edit your own reviews.');
    }
    const ageDays =
      (Date.now() - new Date(review.createdAt).getTime()) /
      (1000 * 60 * 60 * 24);
    if (ageDays > DAYS_EDITABLE) {
      throw new ForbiddenException(
        `Reviews can only be edited within ${DAYS_EDITABLE} days of being posted.`,
      );
    }
    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.comment !== undefined) review.comment = dto.comment;
    const saved = await this.reviewsRepository.save(review);
    return this.serialize(saved, userId);
  }

  async deleteReview(userId: string, reviewId: string): Promise<void> {
    const review = await this.reviewsRepository.findOne({
      where: { id: reviewId },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.reviewerId !== userId) {
      throw new ForbiddenException('You can only delete your own reviews.');
    }
    const ageDays =
      (Date.now() - new Date(review.createdAt).getTime()) /
      (1000 * 60 * 60 * 24);
    if (ageDays > DAYS_DELETABLE) {
      throw new ForbiddenException(
        `Reviews can only be deleted within ${DAYS_DELETABLE} days of being posted.`,
      );
    }
    await this.reviewsRepository.delete({ id: reviewId });
  }

  /**
   * Get aggregate stats for a user split by which side they were on.
   */
  async getUserStats(username: string): Promise<ReviewStats> {
    const user = await this.usersRepository.findOne({
      where: { username },
      select: ['id'],
    });
    if (!user) throw new NotFoundException('User not found');

    const buildStats = async (
      reviewerRole: ReviewerRole,
    ): Promise<{ average: number; count: number }> => {
      // We want reviews about this user when they were on the OPPOSITE side.
      // i.e. "asBuyer" stats are reviews left by the seller (reviewerRole=seller)
      // about this user.
      const raw = await this.reviewsRepository
        .createQueryBuilder('r')
        .select('AVG(r.rating)', 'avg')
        .addSelect('COUNT(*)', 'cnt')
        .where('r.revieweeId = :revieweeId', { revieweeId: user.id })
        .andWhere('r.reviewerRole = :role', { role: reviewerRole })
        .getRawOne<{ avg: string | null; cnt: string }>();
      const count = Number(raw?.cnt ?? 0);
      const average = raw?.avg ? Number(parseFloat(raw.avg).toFixed(2)) : 0;
      return { average, count };
    };

    const asBuyer = await buildStats('seller'); // reviews of them, written by sellers
    const asSeller = await buildStats('buyer'); // reviews of them, written by buyers
    return { asBuyer, asSeller };
  }

  /**
   * Paginated list of reviews about a user.
   * - role=as_buyer  : reviews written by sellers about this user
   * - role=as_seller : reviews written by buyers about this user
   * - role=all       : both
   */
  async listReviewsForUser(
    username: string,
    query: ListReviewsQueryDto,
    viewerId: string | null,
  ): Promise<{
    items: SerializedReview[];
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
  }> {
    const user = await this.usersRepository.findOne({
      where: { username },
      select: ['id'],
    });
    if (!user) throw new NotFoundException('User not found');

    const role: ReviewListRoleFilter = query.role ?? 'all';
    const sort: ReviewListSort = query.sort ?? 'newest';
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;

    const qb = this.reviewsRepository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.reviewer', 'reviewer')
      .leftJoinAndSelect('r.reviewee', 'reviewee')
      .leftJoinAndSelect('r.order', 'order')
      .leftJoinAndSelect('order.prizeConfiguration', 'prize')
      .where('r.revieweeId = :revieweeId', { revieweeId: user.id });

    if (role === 'as_buyer') {
      qb.andWhere('r.reviewerRole = :rrole', { rrole: 'seller' });
    } else if (role === 'as_seller') {
      qb.andWhere('r.reviewerRole = :rrole', { rrole: 'buyer' });
    }

    switch (sort) {
      case 'oldest':
        qb.orderBy('r.createdAt', 'ASC');
        break;
      case 'highest':
        qb.orderBy('r.rating', 'DESC').addOrderBy('r.createdAt', 'DESC');
        break;
      case 'lowest':
        qb.orderBy('r.rating', 'ASC').addOrderBy('r.createdAt', 'DESC');
        break;
      case 'newest':
      default:
        qb.orderBy('r.createdAt', 'DESC');
        break;
    }

    const total = await qb.getCount();
    const reviews = await qb
      .skip((page - 1) * perPage)
      .take(perPage)
      .getMany();

    return {
      items: reviews.map((r) => this.serialize(r, viewerId)),
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /**
   * For the current user, list their orders that are reviewable
   * (whether or not they've already submitted a review). Useful for the
   * "Leave a review" UI on order lists.
   */
  async getReviewableOrdersForUser(
    userId: string,
  ): Promise<ReviewableOrderSide[]> {
    // Get orders where user is the buyer
    const buyerOrders = await this.prizeOrderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.prizeConfiguration', 'prize')
      .leftJoinAndSelect('prize.creator', 'creator')
      .where('order.userId = :userId', { userId })
      .andWhere('order.status IN (:...statuses)', {
        statuses: PAID_LIKE_STATUSES,
      })
      .getMany();

    // Get orders where user is the seller
    const sellerOrders = await this.prizeOrderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.prizeConfiguration', 'prize')
      .leftJoinAndSelect('prize.creator', 'creator')
      .where('prize.createdBy = :userId', { userId })
      .andWhere('order.status IN (:...statuses)', {
        statuses: PAID_LIKE_STATUSES,
      })
      .andWhere('order.userId != :userId', { userId })
      .getMany();

    const allOrderIds = [
      ...buyerOrders.map((o) => o.id),
      ...sellerOrders.map((o) => o.id),
    ];
    const myReviews = allOrderIds.length
      ? await this.reviewsRepository
          .createQueryBuilder('r')
          .leftJoinAndSelect('r.reviewer', 'reviewer')
          .leftJoinAndSelect('r.reviewee', 'reviewee')
          .where('r.reviewerId = :userId', { userId })
          .andWhere('r.orderId IN (:...orderIds)', { orderIds: allOrderIds })
          .getMany()
      : [];
    const reviewByOrderId = new Map<string, Review>();
    for (const r of myReviews) reviewByOrderId.set(r.orderId, r);

    const buildSide = (
      order: PrizeOrder,
      myRole: ReviewerRole,
    ): ReviewableOrderSide | null => {
      const sellerId = order.prizeConfiguration?.createdBy;
      const buyerId = order.userId;
      let counterparty: User | null = null;
      if (myRole === 'buyer') {
        counterparty = order.prizeConfiguration?.creator ?? null;
        if (!sellerId || !counterparty) return null;
      } else {
        counterparty = order.user ?? null;
        if (!buyerId || !counterparty) return null;
      }
      const existing = reviewByOrderId.get(order.id) ?? null;
      return {
        orderId: order.id,
        itemName: order.prizeConfiguration?.name ?? '',
        itemImageUrl:
          (order.prizeConfiguration as { imageUrl?: string | null })
            ?.imageUrl ?? null,
        purchasedAt: order.createdAt,
        shippedAt: order.shippedAt ?? null,
        counterparty: this.toPublicUser(counterparty),
        myRole,
        existingReview: existing ? this.serialize(existing, userId) : null,
        reviewableAt: this.reviewableAt(order),
        isReviewable: this.isOrderReviewable(order),
      };
    };

    const items: ReviewableOrderSide[] = [];
    for (const o of buyerOrders) {
      const side = buildSide(o, 'buyer');
      if (side) items.push(side);
    }
    for (const o of sellerOrders) {
      const side = buildSide(o, 'seller');
      if (side) items.push(side);
    }
    // Sort newest purchase first
    items.sort(
      (a, b) =>
        new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime(),
    );
    return items;
  }

  /**
   * Get the current user's review for a specific order (if any), plus
   * resolved counterparty info. Useful for prefilling an edit form.
   */
  async getReviewForOrder(
    userId: string,
    orderId: string,
  ): Promise<ReviewableOrderSide> {
    const order = await this.loadOrderForReview(orderId);
    const { buyerId, sellerId } = this.resolveParties(order);
    let myRole: ReviewerRole;
    if (userId === buyerId) myRole = 'buyer';
    else if (sellerId && userId === sellerId) myRole = 'seller';
    else throw new ForbiddenException('Not a participant of this order.');

    const existing = await this.reviewsRepository.findOne({
      where: { orderId, reviewerId: userId },
      relations: ['reviewer', 'reviewee', 'order', 'order.prizeConfiguration'],
    });
    const counterparty: User | null =
      myRole === 'buyer'
        ? (order.prizeConfiguration?.creator ?? null)
        : (order.user ?? null);
    return {
      orderId: order.id,
      itemName: order.prizeConfiguration?.name ?? '',
      itemImageUrl:
        (order.prizeConfiguration as { imageUrl?: string | null })?.imageUrl ??
        null,
      purchasedAt: order.createdAt,
      shippedAt: order.shippedAt ?? null,
      counterparty: this.toPublicUser(counterparty),
      myRole,
      existingReview: existing ? this.serialize(existing, userId) : null,
      reviewableAt: this.reviewableAt(order),
      isReviewable: this.isOrderReviewable(order),
    };
  }

  // ─── Used by the scheduled reminder ─────────────────────────────────

  /**
   * Returns true if the given user has already left a review for the
   * given order. Used to avoid sending review reminder emails to people
   * who already reviewed.
   */
  async hasUserReviewedOrder(
    userId: string,
    orderId: string,
  ): Promise<boolean> {
    const count = await this.reviewsRepository.count({
      where: { orderId, reviewerId: userId },
    });
    return count > 0;
  }

  /**
   * Find paid orders that are between [olderThanMs, newerThanMs] old (relative
   * to a chosen anchor field) and have not yet had a review reminder sent.
   * Used by the scheduled task. Anchored on `createdAt` for the 14-day fallback,
   * and on `shippedAt` for the 7-day-after-ship trigger.
   */
  async findOrdersForReminder(opts: {
    anchor: 'createdAt' | 'shippedAt';
    minAgeDays: number;
  }): Promise<PrizeOrder[]> {
    const cutoff = new Date(Date.now() - opts.minAgeDays * 24 * 60 * 60 * 1000);
    const qb = this.prizeOrderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.prizeConfiguration', 'prize')
      .leftJoinAndSelect('prize.creator', 'creator')
      .where('order.status IN (:...statuses)', {
        statuses: PAID_LIKE_STATUSES,
      })
      .andWhere('order.reviewReminderSentAt IS NULL')
      .andWhere(
        new Brackets((qb2) => {
          if (opts.anchor === 'shippedAt') {
            qb2
              .where('order.shippedAt IS NOT NULL')
              .andWhere('order.shippedAt <= :cutoff', { cutoff });
          } else {
            qb2.where('order.createdAt <= :cutoff', { cutoff });
          }
        }),
      );
    return qb.getMany();
  }

  async markReviewReminderSent(orderId: string): Promise<void> {
    await this.prizeOrderRepository.update(orderId, {
      reviewReminderSentAt: new Date(),
    });
  }
}
