import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Auction } from '../prize/entities/auction.entity';
import { AuctionBid } from '../prize/entities/auction-bid.entity';
import { PrizeConfiguration } from '../prize/entities/prize-configuration.entity';
import { User } from '../users/entities/user.entity';
import { AuctionStatus } from '../prize/enums/auction-status.enum';
import { PrizeSaleType } from '../prize/enums/prize-sale-type.enum';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';
import { AuctionsPaymentsService } from './auctions-payments.service';
import { AuctionsGateway } from './auctions.gateway';
import { AuctionsNotificationsService } from './auctions-notifications.service';
import { AuctionSummaryDto } from '../prize/dto/prize-config.dto';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import {
  AUCTION_AUTOPAY_RETRY_JOB,
  AUCTION_CLOSE_JOB,
  AUCTION_CLOSING_SOON_JOB,
  AUCTION_QUEUE,
} from '../common/constants/queue.constants';
import {
  BUYER_PROCESSING_FEE_PERCENT,
  SELLER_FEE_DEFAULT_PERCENT,
  calculateBuyerProcessingFeeCents,
  calculateRewardCadeCoinsFromCents,
  calculateSellerFeeCents,
} from '../common/utils/fee-utils';

/**
 * Anti-snipe window in seconds. A bid landing within this window of
 * `endsAt` extends the auction by the same amount. No cap on extensions.
 */
const ANTI_SNIPE_WINDOW_SECONDS = 30;

/**
 * Dynamic minimum bid increments by current price tier. The increment is
 * applied to the *current* bid to compute the next minimum.
 */
function minIncrementForCurrent(currentUsd: number): number {
  if (currentUsd < 50) return 1;
  if (currentUsd < 250) return 3;
  return 5;
}

/**
 * Core auction lifecycle + bidding engine.
 *
 * Threading model:
 *   placeBid runs inside a SERIALIZABLE transaction with a row-level
 *   lock on the auction row (SELECT ... FOR UPDATE) to serialize
 *   concurrent bidders. Inside the lock we compute the new visible
 *   price, the new leader, whether the previous leader's stored proxy
 *   counters back, and how many rows to insert.
 */
@Injectable()
export class AuctionsService implements OnModuleInit {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    @InjectRepository(Auction)
    private readonly auctionRepository: Repository<Auction>,
    @InjectRepository(AuctionBid)
    private readonly bidRepository: Repository<AuctionBid>,
    @InjectRepository(PrizeConfiguration)
    private readonly prizeRepository: Repository<PrizeConfiguration>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(PrizeOrder)
    private readonly orderRepository: Repository<PrizeOrder>,
    private readonly dataSource: DataSource,
    private readonly paymentsService: AuctionsPaymentsService,
    private readonly gateway: AuctionsGateway,
    private readonly notifications: AuctionsNotificationsService,
    @InjectQueue(AUCTION_QUEUE) private readonly auctionQueue: Queue,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Admin: create / cancel
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Verify a prize belongs to the given user. Used by the seller-facing
   * auction creation endpoint to prevent sellers from auctioning items
   * they don't own.
   */
  async assertPrizeOwnedBy(prizeId: string, userId: string): Promise<void> {
    const prize = await this.prizeRepository.findOne({
      where: { id: prizeId },
      select: ['id', 'createdBy'],
    });
    if (!prize) {
      throw new NotFoundException('Prize item not found');
    }
    if (prize.createdBy !== userId) {
      throw new ForbiddenException(
        'You can only create auctions for items you own.',
      );
    }
  }

  async createAuction(
    adminId: string,
    dto: CreateAuctionDto,
  ): Promise<Auction> {
    // Per-user feature flag — applies to both admins and sellers.
    const creator = await this.userRepository.findOne({
      where: { id: adminId },
    });
    if (!creator) {
      throw new NotFoundException('Creating user not found');
    }
    if (!creator.auctionsEnabled) {
      throw new ForbiddenException(
        'Auctions are not enabled for this account.',
      );
    }

    const prize = await this.prizeRepository.findOne({
      where: { id: dto.prizeConfigurationId },
    });
    if (!prize) throw new NotFoundException('Prize item not found');
    if (prize.saleType !== PrizeSaleType.AUCTION) {
      throw new BadRequestException(
        'Item must have saleType=auction before an auction can be created.',
      );
    }

    // Enforce 1-of-1 inventory for auction items.
    if (prize.stock !== 1) {
      throw new BadRequestException(
        'Auction items must have exactly 1 in stock.',
      );
    }

    const existing = await this.auctionRepository.findOne({
      where: { prizeConfigurationId: prize.id },
    });
    if (existing) {
      throw new ConflictException(
        'An auction already exists for this item. Cancel it first or create a new item.',
      );
    }

    if (dto.reservePriceUsd && dto.reservePriceUsd < dto.startingPriceUsd) {
      throw new BadRequestException(
        'Reserve price cannot be less than starting price.',
      );
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const endsAt = new Date(
      startsAt.getTime() + dto.durationDays * 24 * 60 * 60 * 1000,
    );
    const initialStatus =
      startsAt.getTime() <= Date.now()
        ? AuctionStatus.ACTIVE
        : AuctionStatus.SCHEDULED;

    const auction = this.auctionRepository.create({
      prizeConfigurationId: prize.id,
      durationDays: dto.durationDays,
      startsAt,
      endsAt,
      status: initialStatus,
      startingPriceUsd: dto.startingPriceUsd.toFixed(2),
      reservePriceUsd:
        dto.reservePriceUsd !== undefined
          ? dto.reservePriceUsd.toFixed(2)
          : null,
      cardValueUsd:
        dto.cardValueUsd !== undefined ? dto.cardValueUsd.toFixed(2) : null,
      currentBidUsd: null,
      currentLeaderUserId: null,
      proxyMaxUsd: null,
      bidCount: 0,
      extensionCount: 0,
      createdBy: adminId,
    });
    const saved = await this.auctionRepository.save(auction);

    // Mirror cardValue on the prize for analytics convenience.
    if (dto.cardValueUsd !== undefined) {
      await this.prizeRepository.update(
        { id: prize.id },
        { cardValueUsd: dto.cardValueUsd.toFixed(2) },
      );
    }

    this.logger.log(
      `Auction ${saved.id} created for prize ${prize.id} by admin ${adminId} (status=${saved.status})`,
    );

    // Schedule background jobs. If this fails (e.g. Redis hiccup), tear
    // down the auction row so the admin can simply retry — otherwise the
    // prize would be locked behind a stale auction with no scheduled
    // close, and the unique constraint on prize_configuration_id would
    // block any re-creation attempt.
    try {
      await this.scheduleAuctionJobs(saved.id, saved.endsAt);
    } catch (err) {
      this.logger.error(
        `Failed to schedule jobs for auction ${saved.id}; rolling back. ${(err as Error).message}`,
      );
      await this.auctionRepository
        .delete({ id: saved.id })
        .catch(() => undefined);
      throw err;
    }

    return saved;
  }

  async cancelAuction(adminId: string, auctionId: string): Promise<Auction> {
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!auction) throw new NotFoundException('Auction not found');
    if (auction.status === AuctionStatus.PAID) {
      throw new BadRequestException('Cannot cancel a paid auction.');
    }
    auction.status = AuctionStatus.CANCELLED;
    const saved = await this.auctionRepository.save(auction);
    await this.removeAuctionJobs(auction.id);
    this.gateway.emitAuctionUpdate(auction.id, {
      type: 'auction.cancelled',
      auctionId: auction.id,
    });
    this.logger.log(`Auction ${auction.id} cancelled by admin ${adminId}`);
    return saved;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Lifecycle: orphan sweeper
  // ─────────────────────────────────────────────────────────────────────

  /**
   * On boot, find any auctions that should already be closed (status
   * is still ACTIVE/SCHEDULED but `endsAt` is in the past) and run
   * their close flow once. Covers two real-world failure modes:
   *
   *   1. The worker was offline when the BullMQ delayed job fired and
   *      the job got dropped (or BullMQ lost it during a Redis flush).
   *   2. An admin adjusted `ends_at` directly in Postgres, so the
   *      queued job no longer matches reality.
   *
   * Idempotent: `runCloseJob` itself short-circuits on terminal
   * statuses, so re-running is safe.
   */
  async onModuleInit(): Promise<void> {
    try {
      const stuck = await this.auctionRepository.find({
        where: [
          {
            status: AuctionStatus.ACTIVE,
            endsAt: LessThan(new Date()),
          },
          {
            status: AuctionStatus.SCHEDULED,
            endsAt: LessThan(new Date()),
          },
        ],
        select: ['id', 'endsAt', 'status'],
      });
      if (stuck.length === 0) return;
      this.logger.warn(
        `Auction sweeper: found ${stuck.length} overdue auction(s) — running close flow.`,
      );
      for (const a of stuck) {
        try {
          await this.runCloseJob(a.id);
        } catch (err) {
          this.logger.error(
            `Auction sweeper: runCloseJob(${a.id}) failed: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      // Never block app boot on the sweeper.
      this.logger.error(
        `Auction sweeper failed to query overdue auctions: ${(err as Error).message}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Admin: listing
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Lightweight admin listing of every auction with the metadata the
   * Admin → Auctions tab needs to triage state at a glance.
   */
  async listAllForAdmin(): Promise<
    Array<{
      id: string;
      prizeConfigurationId: string;
      prizeName: string;
      status: AuctionStatus;
      startsAt: string;
      endsAt: string;
      durationDays: number;
      startingPriceUsd: number;
      reservePriceUsd: number | null;
      currentBidUsd: number | null;
      bidCount: number;
      extensionCount: number;
      winnerUserId: string | null;
      winnerUsername: string | null;
      paidAt: string | null;
      prizeOrderId: string | null;
      paymentIntentId: string | null;
      isOverdue: boolean;
    }>
  > {
    const rows = await this.auctionRepository.find({
      relations: ['prizeConfiguration'],
      order: { createdAt: 'DESC' as const },
    });
    // Resolve winner usernames in one batch to avoid N+1.
    const winnerIds = Array.from(
      new Set(rows.map((r) => r.winnerUserId).filter((v): v is string => !!v)),
    );
    const winners = winnerIds.length
      ? await this.userRepository
          .createQueryBuilder('u')
          .select(['u.id', 'u.username'])
          .where('u.id IN (:...ids)', { ids: winnerIds })
          .getMany()
      : [];
    const winnerMap = new Map(winners.map((u) => [u.id, u.username]));
    const now = Date.now();
    return rows.map((a) => ({
      id: a.id,
      prizeConfigurationId: a.prizeConfigurationId,
      prizeName: a.prizeConfiguration?.name ?? 'Unknown item',
      status: a.status,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      durationDays: a.durationDays,
      startingPriceUsd: Number(a.startingPriceUsd),
      reservePriceUsd: a.reservePriceUsd ? Number(a.reservePriceUsd) : null,
      currentBidUsd: a.currentBidUsd ? Number(a.currentBidUsd) : null,
      bidCount: a.bidCount,
      extensionCount: a.extensionCount,
      winnerUserId: a.winnerUserId ?? null,
      winnerUsername: a.winnerUserId
        ? (winnerMap.get(a.winnerUserId) ?? null)
        : null,
      paidAt: a.paidAt ? a.paidAt.toISOString() : null,
      prizeOrderId: a.prizeOrderId ?? null,
      paymentIntentId: a.paymentIntentId ?? null,
      // Overdue when the close job hasn't terminalized this row yet.
      isOverdue:
        (a.status === AuctionStatus.ACTIVE ||
          a.status === AuctionStatus.SCHEDULED) &&
        a.endsAt.getTime() < now,
    }));
  }

  /**
   * Admin: full per-auction detail including the winner and (when paid)
   * the linked PrizeOrder's shipping address. Used by the Edit Item
   * dialog so ops can ship the prize without leaving the screen.
   *
   * Returns `null` for winner/shipping fields when the auction hasn't
   * resolved yet (still active, unsold, cancelled with no charge, etc.).
   */
  async getAdminDetails(auctionId: string): Promise<{
    id: string;
    status: AuctionStatus;
    winnerUserId: string | null;
    winner: {
      id: string;
      username: string;
      email: string | null;
    } | null;
    paidAt: string | null;
    paymentIntentId: string | null;
    prizeOrderId: string | null;
    winningBidUsd: number | null;
    shippingAddress: PrizeOrder['shippingAddress'] | null;
    orderStatus: string | null;
  }> {
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!auction) {
      throw new NotFoundException('Auction not found');
    }

    const winner = auction.winnerUserId
      ? await this.userRepository.findOne({
          where: { id: auction.winnerUserId },
          select: ['id', 'username', 'email'],
        })
      : null;

    // The prize order is only created on a successful charge, so it may
    // be missing for unsold/failed/cancelled auctions even when there
    // was a winner.
    const order = auction.prizeOrderId
      ? await this.orderRepository.findOne({
          where: { id: auction.prizeOrderId },
        })
      : null;

    return {
      id: auction.id,
      status: auction.status,
      winnerUserId: auction.winnerUserId,
      winner: winner
        ? {
            id: winner.id,
            username: winner.username,
            email: winner.email ?? null,
          }
        : null,
      paidAt: auction.paidAt ? auction.paidAt.toISOString() : null,
      paymentIntentId: auction.paymentIntentId,
      prizeOrderId: auction.prizeOrderId,
      winningBidUsd: auction.currentBidUsd
        ? Number(auction.currentBidUsd)
        : null,
      shippingAddress: order?.shippingAddress ?? null,
      orderStatus: order?.status ?? null,
    };
  }

  async getAdminBidHistory(auctionId: string): Promise<
    {
      id: string;
      userId: string;
      username: string | null;
      amountUsd: number;
      proxyMaxUsd: number;
      isProxyAuto: boolean;
      createdAt: string;
    }[]
  > {
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
      select: ['id'],
    });
    if (!auction) {
      throw new NotFoundException('Auction not found');
    }

    const rows = await this.bidRepository
      .createQueryBuilder('b')
      .leftJoin('users', 'u', 'u.id = b.user_id')
      .select([
        'b.id AS id',
        'b.user_id AS "userId"',
        'u.username AS username',
        'b.amount_usd AS "amountUsd"',
        'b.proxy_max_usd AS "proxyMaxUsd"',
        'b.is_proxy_auto AS "isProxyAuto"',
        'b."createdAt" AS "createdAt"',
      ])
      .where('b.auction_id = :auctionId', { auctionId })
      .orderBy('b."createdAt"', 'DESC')
      .getRawMany<{
        id: string;
        userId: string;
        username: string | null;
        amountUsd: string;
        proxyMaxUsd: string;
        isProxyAuto: boolean;
        createdAt: Date;
      }>();

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.username,
      amountUsd: Number(r.amountUsd),
      proxyMaxUsd: Number(r.proxyMaxUsd),
      isProxyAuto: r.isProxyAuto,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  // ─────────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────────

  async getById(auctionId: string): Promise<Auction> {
    const a = await this.auctionRepository.findOne({
      where: { id: auctionId },
      // Eager-load the prize so buildSummary can read shippingCostUsd
      // without an extra query.
      relations: ['prizeConfiguration'],
    });
    if (!a) throw new NotFoundException('Auction not found');
    return a;
  }

  async listActive(): Promise<Auction[]> {
    return this.auctionRepository.find({
      where: { status: AuctionStatus.ACTIVE },
      order: { endsAt: 'ASC' },
      // Same reason as getById: shipping lives on the parent prize.
      relations: ['prizeConfiguration'],
    });
  }

  /**
   * Build a per-user public summary used by the prize DTO. Reserve price
   * is intentionally hidden — only `reserveMet` (true|false|null) is
   * exposed.
   */
  buildSummary(
    auction: Auction,
    opts: {
      userId?: string;
      isBidder?: boolean;
      /**
       * Per-item shipping fee. Callers that already have the parent
       * `PrizeConfiguration` loaded (e.g. PrizeService.mapToDto) should
       * pass it explicitly. Falls back to the auction's own (lazy)
       * relation, then to the legacy default of $5.
       */
      shippingCostUsd?: number | null;
    } = {},
  ): AuctionSummaryDto {
    const current = auction.currentBidUsd
      ? Number(auction.currentBidUsd)
      : null;
    const start = Number(auction.startingPriceUsd);
    const reserve = auction.reservePriceUsd
      ? Number(auction.reservePriceUsd)
      : null;

    const inc = minIncrementForCurrent(current ?? start);
    const minNext = current === null ? start : +(current + inc).toFixed(2);

    const reserveMet =
      reserve === null ? null : current !== null && current >= reserve;

    // Per-item shipping (see opts docs above) — fold it into the buyer's
    // "if I win" totals so the bid modal preview matches what we'll
    // actually charge at close.
    const shippingForFees =
      opts.shippingCostUsd != null
        ? Number(opts.shippingCostUsd)
        : auction.prizeConfiguration?.shippingCostUsd
          ? Number(auction.prizeConfiguration.shippingCostUsd)
          : 5;

    const fees = this.computeAuctionFees(current ?? 0, shippingForFees);
    const minNextFees = this.computeAuctionFees(minNext, shippingForFees);

    return {
      id: auction.id,
      status: auction.status,
      startsAt: auction.startsAt.toISOString(),
      endsAt: auction.endsAt.toISOString(),
      durationDays: auction.durationDays,
      startingPriceUsd: start,
      currentBidUsd: current,
      minNextBidIncrement: inc,
      minNextBidUsd: minNext,
      bidCount: auction.bidCount,
      extensionCount: auction.extensionCount,
      reserveMet,
      isLeader: !!opts.userId && auction.currentLeaderUserId === opts.userId,
      isBidder: !!opts.isBidder,
      buyerProcessingFeePercent: BUYER_PROCESSING_FEE_PERCENT,
      buyerProcessingFeeUsd:
        current === null ? null : fees.buyerProcessingFeeUsd,
      totalDueIfWonUsd: current === null ? null : fees.totalChargedUsd,
      minNextBidProcessingFeeUsd: minNextFees.buyerProcessingFeeUsd,
      minNextBidTotalUsd: minNextFees.totalChargedUsd,
      currentUserProxyMaxUsd:
        !!opts.userId &&
        auction.currentLeaderUserId === opts.userId &&
        auction.proxyMaxUsd
          ? Number(auction.proxyMaxUsd)
          : null,
      // Shipping mirrors what we just rolled into the fee preview, so
      // the bid modal "Shipping" line and the totals stay in sync.
      shippingCostUsd: shippingForFees,
    };
  }

  /**
   * Returns the set of auctionIds in `auctionIds` that `userId` has
   * bid on. Used by listing endpoints to populate `isBidder` cheaply
   * in one round-trip.
   */
  async getBidderAuctionIds(
    userId: string,
    auctionIds: string[],
  ): Promise<Set<string>> {
    if (!userId || auctionIds.length === 0) return new Set();
    const rows = await this.bidRepository
      .createQueryBuilder('b')
      .select('DISTINCT b.auction_id', 'auctionId')
      .where('b.user_id = :userId', { userId })
      .andWhere('b.auction_id IN (:...ids)', { ids: auctionIds })
      .getRawMany<{ auctionId: string }>();
    return new Set(rows.map((r) => r.auctionId));
  }

  /**
   * Every auction the given user has placed at least one bid on,
   * ordered by their most-recent bid (newest first). Powers the
   * "My Bids" page so the items the bidder is most actively engaged
   * with float to the top.
   */
  async getRecentBidAuctions(
    userId: string,
  ): Promise<{ auctionId: string; lastBidAt: Date }[]> {
    if (!userId) return [];
    // NOTE: `auction_bids` uses snake_case for explicitly-named columns
    // (auction_id, user_id) but the default `@CreateDateColumn()` keeps
    // its camelCase property name → quoted "createdAt" column.
    const rows = await this.bidRepository
      .createQueryBuilder('b')
      .select('b.auction_id', 'auctionId')
      .addSelect('MAX(b."createdAt")', 'lastBidAt')
      .where('b.user_id = :userId', { userId })
      .groupBy('b.auction_id')
      .orderBy('MAX(b."createdAt")', 'DESC')
      .getRawMany<{ auctionId: string; lastBidAt: Date }>();
    return rows.map((r) => ({
      auctionId: r.auctionId,
      lastBidAt: new Date(r.lastBidAt),
    }));
  }

  // ─────────────────────────────────────────────────────────────────────
  // Bidding
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Place a bid (proxy-style). The bidder's `proxyMaxUsd` is their
   * willing-to-pay max. We resolve the visible new price by simulating
   * the proxy war between (a) this bidder and (b) the existing leader's
   * stored proxy max.
   *
   * Returns the updated auction row + the inserted primary bid.
   */
  async placeBid(
    userId: string,
    auctionId: string,
    dto: PlaceBidDto,
  ): Promise<{ auction: Auction; bid: AuctionBid }> {
    if (!Number.isFinite(dto.proxyMaxUsd) || dto.proxyMaxUsd <= 0) {
      throw new BadRequestException('Invalid bid amount');
    }
    const proxyMax = +dto.proxyMaxUsd.toFixed(2);

    // Self-bid guard: a seller cannot bid on their own item. Mirrors the
    // shop's "you can't buy your own item" rule. We resolve the seller via
    // PrizeConfiguration.createdBy. CardCade-seeded items have a null /
    // 'cardcade' creator and are always biddable by everyone.
    const auctionPrecheck = await this.auctionRepository.findOne({
      where: { id: auctionId },
      relations: ['prizeConfiguration'],
    });
    if (!auctionPrecheck) throw new NotFoundException('Auction not found');
    const sellerId = auctionPrecheck.prizeConfiguration?.createdBy ?? null;
    if (sellerId && sellerId !== 'cardcade' && sellerId === userId) {
      throw new BadRequestException('You cannot bid on your own item.');
    }

    // Resolve a saved card up front (outside tx). The bidder must either
    // pass an explicit `stripePaymentMethodId` or already have at least
    // one saved card — the controller pre-checks for nicer UX.
    let paymentMethodId: string | null = dto.stripePaymentMethodId ?? null;
    if (paymentMethodId) {
      await this.paymentsService.assertPaymentMethodBelongsToUser(
        userId,
        paymentMethodId,
      );
    } else {
      const saved = await this.paymentsService.listSavedCards(userId);
      if (saved.length === 0) {
        throw new BadRequestException(
          'You must save a card before bidding. Run the SetupIntent flow first.',
        );
      }
      paymentMethodId = saved[0].id;
    }

    const result = await this.dataSource.transaction(
      'SERIALIZABLE',
      async (manager) => {
        const auctionRepo = manager.getRepository(Auction);
        const bidRepo = manager.getRepository(AuctionBid);

        // Lock the auction row
        const auction = await auctionRepo
          .createQueryBuilder('a')
          .setLock('pessimistic_write')
          .where('a.id = :id', { id: auctionId })
          .getOne();
        if (!auction) throw new NotFoundException('Auction not found');

        if (auction.status !== AuctionStatus.ACTIVE) {
          throw new BadRequestException('Auction is not active');
        }
        if (auction.endsAt.getTime() <= Date.now()) {
          throw new BadRequestException('Auction has already ended');
        }
        if (auction.currentLeaderUserId === userId) {
          // Leader is raising their own proxy max. The visible bid does
          // not change (no one to counter), but we record the new proxy
          // ceiling and append a bid row so the action is auditable.
          const existingProxy = auction.proxyMaxUsd
            ? Number(auction.proxyMaxUsd)
            : 0;
          if (proxyMax <= existingProxy) {
            throw new BadRequestException(
              `Your new max must be higher than your current max ($${existingProxy.toFixed(2)}).`,
            );
          }

          // Anti-snipe still applies — raising your max within the
          // window is enough activity to extend, matching how regular
          // bids behave.
          const msToEnd = auction.endsAt.getTime() - Date.now();
          let extended = false;
          if (msToEnd <= ANTI_SNIPE_WINDOW_SECONDS * 1000) {
            auction.endsAt = new Date(
              auction.endsAt.getTime() + ANTI_SNIPE_WINDOW_SECONDS * 1000,
            );
            auction.extensionCount += 1;
            extended = true;
          }

          const raiseBid = bidRepo.create({
            auctionId: auction.id,
            userId,
            // Audit row: amount = current visible bid (unchanged), but
            // proxyMax records the raised ceiling.
            amountUsd: (auction.currentBidUsd
              ? Number(auction.currentBidUsd)
              : Number(auction.startingPriceUsd)
            ).toFixed(2),
            proxyMaxUsd: proxyMax.toFixed(2),
            isProxyAuto: false,
            stripePaymentMethodId: paymentMethodId,
          });
          await bidRepo.save(raiseBid);

          auction.proxyMaxUsd = proxyMax.toFixed(2);
          auction.bidCount += 1;
          const savedAuction = await auctionRepo.save(auction);
          return {
            auction: savedAuction,
            bid: raiseBid,
            previousLeaderId: userId,
            extended,
          };
        }

        const start = Number(auction.startingPriceUsd);
        const currentVisible = auction.currentBidUsd
          ? Number(auction.currentBidUsd)
          : null;
        const leaderProxy = auction.proxyMaxUsd
          ? Number(auction.proxyMaxUsd)
          : null;

        // Minimum-bid validation
        const minNextBid =
          currentVisible === null
            ? start
            : +(
                currentVisible + minIncrementForCurrent(currentVisible)
              ).toFixed(2);
        if (proxyMax < minNextBid) {
          throw new BadRequestException(
            `Bid must be at least $${minNextBid.toFixed(2)}.`,
          );
        }

        // Resolve the proxy war.
        // Case A: no leader yet → challenger becomes leader at minNextBid.
        // Case B: leader exists with proxy >= challenger.proxy
        //         → leader auto-counters to challenger.proxy + inc (or
        //           leaderProxy, capped by leaderProxy). Challenger loses
        //           and we insert (i) the challenger's max-bid row at
        //           proxyMax and (ii) an auto-bid row for the leader at
        //           min(leaderProxy, proxyMax + inc).
        // Case C: challenger.proxy > leaderProxy → challenger becomes
        //         leader at min(proxyMax, leaderProxy + inc). We insert
        //         (i) leader auto-bid up to leaderProxy first, then
        //         (ii) the challenger's leading bid at the new visible
        //         price, with proxyMax cached as new proxy.
        const incFromCurrent = minIncrementForCurrent(currentVisible ?? start);

        let newVisible: number;
        let newLeaderId: string;
        let newProxy: number;
        let autoCounterAmount: number | null = null; // leader's auto-bid amount, if any
        const previousLeaderId = auction.currentLeaderUserId;

        if (currentVisible === null || leaderProxy === null) {
          // First bid in the auction
          newVisible = start;
          newLeaderId = userId;
          newProxy = proxyMax;
        } else if (leaderProxy >= proxyMax) {
          // Leader wins the proxy war. Challenger becomes runner-up at proxyMax.
          newLeaderId = previousLeaderId!;
          newVisible = Math.min(
            leaderProxy,
            +(proxyMax + minIncrementForCurrent(proxyMax)).toFixed(2),
          );
          newProxy = leaderProxy;
          autoCounterAmount = newVisible;
        } else {
          // Challenger overtakes the leader.
          newLeaderId = userId;
          newVisible = Math.min(
            proxyMax,
            +(leaderProxy + incFromCurrent).toFixed(2),
          );
          newProxy = proxyMax;
          autoCounterAmount = leaderProxy; // leader's last auto-counter at their max
        }

        // Anti-snipe extension
        const msToEnd = auction.endsAt.getTime() - Date.now();
        let extended = false;
        if (msToEnd <= ANTI_SNIPE_WINDOW_SECONDS * 1000) {
          auction.endsAt = new Date(
            auction.endsAt.getTime() + ANTI_SNIPE_WINDOW_SECONDS * 1000,
          );
          auction.extensionCount += 1;
          extended = true;
        }

        // Insert bid rows. Challenger first (their conscious action),
        // then any auto-counter from the previous leader.
        const challengerBid = bidRepo.create({
          auctionId: auction.id,
          userId,
          amountUsd: (newLeaderId === userId ? newVisible : proxyMax).toFixed(
            2,
          ),
          proxyMaxUsd: proxyMax.toFixed(2),
          isProxyAuto: false,
          stripePaymentMethodId: paymentMethodId,
        });
        await bidRepo.save(challengerBid);

        if (autoCounterAmount !== null && previousLeaderId) {
          const autoBid = bidRepo.create({
            auctionId: auction.id,
            userId: previousLeaderId,
            amountUsd: autoCounterAmount.toFixed(2),
            proxyMaxUsd: (leaderProxy ?? autoCounterAmount).toFixed(2),
            isProxyAuto: true,
            stripePaymentMethodId: null,
          });
          await bidRepo.save(autoBid);
        }

        // Update cached fields
        auction.currentBidUsd = newVisible.toFixed(2);
        auction.currentLeaderUserId = newLeaderId;
        auction.proxyMaxUsd = newProxy.toFixed(2);
        auction.bidCount += autoCounterAmount !== null ? 2 : 1;

        const savedAuction = await auctionRepo.save(auction);
        return {
          auction: savedAuction,
          bid: challengerBid,
          previousLeaderId,
          extended,
        };
      },
    );

    // Emit socket events outside the transaction
    this.gateway.emitAuctionUpdate(result.auction.id, {
      type: 'bid.placed',
      auctionId: result.auction.id,
      currentBidUsd: result.auction.currentBidUsd
        ? Number(result.auction.currentBidUsd)
        : null,
      currentLeaderUserId: result.auction.currentLeaderUserId,
      bidCount: result.auction.bidCount,
      endsAt: result.auction.endsAt.toISOString(),
    });
    if (result.extended) {
      this.gateway.emitAuctionUpdate(result.auction.id, {
        type: 'auction.extended',
        auctionId: result.auction.id,
        endsAt: result.auction.endsAt.toISOString(),
        extensionCount: result.auction.extensionCount,
      });
    }

    // Reschedule close + closing-soon if anti-snipe extended endsAt.
    if (result.extended) {
      await this.scheduleAuctionJobs(
        result.auction.id,
        result.auction.endsAt,
      ).catch((err) =>
        this.logger.warn(
          `Reschedule after extension failed for ${result.auction.id}: ${(err as Error).message}`,
        ),
      );
    }

    // Outbid notification (debounced 5 min per (auction,user) via Redis).
    if (
      result.previousLeaderId &&
      result.previousLeaderId !== result.auction.currentLeaderUserId
    ) {
      this.notifications
        .notifyOutbid({
          previousLeaderUserId: result.previousLeaderId,
          auctionId: result.auction.id,
        })
        .catch((err) =>
          this.logger.warn(
            `notifyOutbid failed for auction ${result.auction.id}: ${(err as Error).message}`,
          ),
        );
    }

    return { auction: result.auction, bid: result.bid };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Fees
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Compute fee breakdown for a hypothetical winning bid.
   *
   * Mirrors the existing sales fee policy in `fee-utils.ts`:
   *   - Buyer pays a 3% processing fee on top of the bid (no shipping).
   *   - Platform (seller = CardCade) takes a 4% seller fee from the
   *     subtotal. Auctions are platform-listed so milestone reductions
   *     do not apply.
   *   - 3 CadeCoins per $100 of total transaction are awarded to the
   *     winning bidder (parity with shop purchases).
   *
   * Returns USD floats (rounded to cents) so callers can serialize for
   * DTOs or pass directly to chargeWinner.
   */
  computeAuctionFees(
    bidUsd: number,
    shippingUsd: number = 0,
  ): {
    bidUsd: number;
    buyerProcessingFeeUsd: number;
    shippingUsd: number;
    totalChargedUsd: number;
    sellerFeeUsd: number;
    sellerNetUsd: number;
    rewardCadeCoins: number;
  } {
    const subtotalCents = Math.max(0, Math.round(bidUsd * 100));
    const shippingCents = Math.max(0, Math.round(shippingUsd * 100));
    const buyerFeeCents = calculateBuyerProcessingFeeCents(subtotalCents);
    // Shipping is passed straight through to the buyer (no fee taken on
    // it) and excluded from the seller payout calc.
    const totalChargedCents = subtotalCents + buyerFeeCents + shippingCents;
    const sellerFeeCents = calculateSellerFeeCents(
      subtotalCents,
      SELLER_FEE_DEFAULT_PERCENT,
    );
    const sellerNetCents = subtotalCents - sellerFeeCents;
    const rewardCadeCoins =
      calculateRewardCadeCoinsFromCents(totalChargedCents);
    return {
      bidUsd: subtotalCents / 100,
      buyerProcessingFeeUsd: buyerFeeCents / 100,
      shippingUsd: shippingCents / 100,
      totalChargedUsd: totalChargedCents / 100,
      sellerFeeUsd: sellerFeeCents / 100,
      sellerNetUsd: sellerNetCents / 100,
      rewardCadeCoins,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Job scheduling
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Idempotent: schedule (or reschedule) the close + closing-soon jobs
   * for an auction. Existing jobs with the same deterministic id are
   * removed first so anti-snipe extensions can simply call this method
   * again with the new endsAt.
   *
   * Closing-soon fires 1 hour before endsAt (skipped if <1h remains).
   * Close fires at endsAt (delay clamped to >=0 so a job already past
   * its end runs immediately).
   */
  async scheduleAuctionJobs(auctionId: string, endsAt: Date): Promise<void> {
    // BullMQ rejects custom job IDs containing ':' with the literal error
    // "Custom Id cannot contain :" (Redis uses ':' as its key separator).
    // Use '__' as a delimiter that's safe across Redis + URL contexts.
    const closeJobId = `auction-close__${auctionId}`;
    const soonJobId = `auction-closing-soon__${auctionId}`;
    const now = Date.now();
    const closeDelay = Math.max(0, endsAt.getTime() - now);
    const soonDelay = Math.max(0, endsAt.getTime() - 60 * 60 * 1000 - now);

    // Remove any existing scheduled jobs (idempotent reschedule).
    await Promise.allSettled([
      this.auctionQueue.remove(closeJobId).catch(() => undefined),
      this.auctionQueue.remove(soonJobId).catch(() => undefined),
    ]);

    await this.auctionQueue.add(
      AUCTION_CLOSE_JOB,
      { auctionId },
      {
        jobId: closeJobId,
        delay: closeDelay,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );

    // Only schedule closing-soon if there's still >5 min before the
    // 1-hour mark — otherwise the email would arrive after the auction
    // ended which is a worse experience than no email.
    if (endsAt.getTime() - now > 65 * 60 * 1000) {
      await this.auctionQueue.add(
        AUCTION_CLOSING_SOON_JOB,
        { auctionId },
        {
          jobId: soonJobId,
          delay: soonDelay,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    }

    this.logger.log(
      `Scheduled auction jobs for ${auctionId}: close in ${Math.round(
        closeDelay / 1000,
      )}s, closing-soon in ${Math.round(soonDelay / 1000)}s`,
    );
  }

  /** Remove all pending jobs for an auction (used on cancel). */
  async removeAuctionJobs(auctionId: string): Promise<void> {
    await Promise.allSettled([
      this.auctionQueue
        .remove(`auction-close__${auctionId}`)
        .catch(() => undefined),
      this.auctionQueue
        .remove(`auction-closing-soon__${auctionId}`)
        .catch(() => undefined),
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Close job + autopay retry
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Run by the AUCTION_CLOSE_JOB worker.
   *
   * Behavior:
   *   - If endsAt has been pushed into the future (anti-snipe extended
   *     while this job was sitting in the queue), reschedule and exit.
   *   - If the auction was cancelled or already paid, exit.
   *   - If no bids OR reserve unmet → status = UNSOLD.
   *   - Else → attempt off-session charge against the leader's saved
   *     payment method. Branch on PaymentIntent status:
   *       - succeeded → status = PAID, create PrizeOrder, decrement
   *         stock, notify winner + losers.
   *       - requires_action / processing → status = PENDING_PAYMENT,
   *         notify winner with action-required message.
   *       - failed/declined → status = FAILED, schedule autopay-retry
   *         in 24h to attempt the runner-up.
   */
  async runCloseJob(auctionId: string): Promise<void> {
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!auction) {
      this.logger.warn(`Close job: auction ${auctionId} not found`);
      return;
    }

    // Auction was extended after we queued — just reschedule.
    if (auction.endsAt.getTime() > Date.now() + 5_000) {
      this.logger.log(
        `Close job for ${auctionId}: endsAt now ${auction.endsAt.toISOString()} > now, rescheduling`,
      );
      await this.scheduleAuctionJobs(auctionId, auction.endsAt);
      return;
    }

    if (
      auction.status === AuctionStatus.CANCELLED ||
      auction.status === AuctionStatus.PAID ||
      auction.status === AuctionStatus.UNSOLD
    ) {
      this.logger.log(
        `Close job for ${auctionId}: status=${auction.status}, nothing to do`,
      );
      return;
    }

    const winnerId = auction.currentLeaderUserId;
    const winningBidUsd = auction.currentBidUsd
      ? Number(auction.currentBidUsd)
      : null;
    const reserveUsd = auction.reservePriceUsd
      ? Number(auction.reservePriceUsd)
      : null;

    // No-bid or reserve unmet → mark UNSOLD and notify the high bidder
    // (if any) that they didn't win.
    if (
      !winnerId ||
      winningBidUsd === null ||
      (reserveUsd !== null && winningBidUsd < reserveUsd)
    ) {
      auction.status = AuctionStatus.UNSOLD;
      await this.auctionRepository.save(auction);
      this.gateway.emitAuctionUpdate(auctionId, {
        type: 'auction.closed',
        auctionId,
        outcome: 'unsold',
      });
      // Bidders who placed bids that didn't clear the reserve still
      // deserve the closure email.
      await this.notifications
        .notifyLosers({
          auctionId,
          winnerUserId: null,
          winningBidUsd: winningBidUsd ?? 0,
        })
        .catch((err) =>
          this.logger.warn(
            `notifyLosers (unsold) failed: ${(err as Error).message}`,
          ),
        );
      this.logger.log(`Auction ${auctionId} closed UNSOLD`);
      return;
    }

    await this.attemptAutopayAndFinalize({
      auction,
      winnerUserId: winnerId,
      winningBidUsd,
    });
  }

  /**
   * Run by the AUCTION_AUTOPAY_RETRY_JOB worker after the 24h grace
   * period when the original winner's card declined. Picks the next
   * eligible bidder (highest distinct user other than the previous
   * winner) and tries again.
   */
  async runAutopayRetry(
    auctionId: string,
    excludeUserId: string | undefined,
  ): Promise<void> {
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!auction) return;
    if (
      auction.status === AuctionStatus.PAID ||
      auction.status === AuctionStatus.CANCELLED ||
      auction.status === AuctionStatus.UNSOLD
    ) {
      this.logger.log(
        `Autopay retry: auction ${auctionId} status=${auction.status}, abort`,
      );
      return;
    }

    // Find the next eligible bidder: highest amountUsd among users
    // other than `excludeUserId`. Ties broken by earliest bid time.
    const qb = this.bidRepository
      .createQueryBuilder('b')
      .select('b.user_id', 'userId')
      .addSelect('MAX(b.amount_usd)', 'maxAmount')
      .where('b.auction_id = :id', { id: auctionId });
    if (excludeUserId) {
      qb.andWhere('b.user_id != :ex', { ex: excludeUserId });
    }
    const rows = await qb
      .groupBy('b.user_id')
      .orderBy('MAX(b.amount_usd)', 'DESC')
      .limit(1)
      .getRawMany<{ userId: string; maxAmount: string }>();

    if (rows.length === 0) {
      auction.status = AuctionStatus.UNSOLD;
      await this.auctionRepository.save(auction);
      this.gateway.emitAuctionUpdate(auctionId, {
        type: 'auction.closed',
        auctionId,
        outcome: 'unsold',
      });
      this.logger.log(
        `Autopay retry: no runner-up for ${auctionId}, marked UNSOLD`,
      );
      return;
    }

    const runnerUp = rows[0];
    const runnerUpBidUsd = Number(runnerUp.maxAmount);
    this.logger.log(
      `Autopay retry: trying runner-up ${runnerUp.userId} at $${runnerUpBidUsd} for ${auctionId}`,
    );

    // Update the auction's leader/visible price to the runner-up before
    // attempting the charge so the eventual order matches.
    auction.currentLeaderUserId = runnerUp.userId;
    auction.currentBidUsd = runnerUpBidUsd.toFixed(2);
    await this.auctionRepository.save(auction);

    await this.attemptAutopayAndFinalize({
      auction,
      winnerUserId: runnerUp.userId,
      winningBidUsd: runnerUpBidUsd,
    });
  }

  /**
   * Charge the saved card for `winnerUserId` for the winning bid + 3%
   * buyer processing fee. On success, mark PAID and create a PrizeOrder.
   * On Stripe decline, mark FAILED and schedule the runner-up retry.
   */
  private async attemptAutopayAndFinalize(params: {
    auction: Auction;
    winnerUserId: string;
    winningBidUsd: number;
  }): Promise<void> {
    const { auction, winnerUserId, winningBidUsd } = params;
    // Resolve per-item shipping. Migration backfilled $5 for existing
    // rows; new items can be customized in admin.
    let shippingUsd = 5;
    try {
      const prize = await this.prizeRepository.findOne({
        where: { id: auction.prizeConfigurationId },
        select: ['id', 'shippingCostUsd'],
      });
      if (prize?.shippingCostUsd != null) {
        shippingUsd = Number(prize.shippingCostUsd);
      }
    } catch {
      // fall back to default; never block the charge on shipping lookup.
    }
    const fees = this.computeAuctionFees(winningBidUsd, shippingUsd);

    // Resolve the winner's most recent saved payment method for this
    // auction. Their leading bid row carries the pm id when available.
    const leadingBid = await this.bidRepository.findOne({
      where: {
        auctionId: auction.id,
        userId: winnerUserId,
      },
      order: { createdAt: 'DESC' as const },
    });

    let paymentMethodId = leadingBid?.stripePaymentMethodId ?? null;
    if (!paymentMethodId) {
      const cards = await this.paymentsService.listSavedCards(winnerUserId);
      paymentMethodId = cards[0]?.id ?? null;
    }

    if (!paymentMethodId) {
      this.logger.warn(
        `Auction ${auction.id}: winner ${winnerUserId} has no saved card; marking FAILED`,
      );
      auction.status = AuctionStatus.FAILED;
      await this.auctionRepository.save(auction);
      await this.scheduleAutopayRetry(auction.id, winnerUserId);
      return;
    }

    let intent: Awaited<ReturnType<typeof this.paymentsService.chargeWinner>>;
    try {
      intent = await this.paymentsService.chargeWinner({
        userId: winnerUserId,
        paymentMethodId,
        amountUsd: fees.totalChargedUsd,
        auctionId: auction.id,
        description: `CardCade auction ${auction.id} winning bid + processing fee + shipping`,
      });
    } catch (err) {
      this.logger.warn(
        `Auction ${auction.id} charge raised: ${(err as Error).message}`,
      );
      auction.status = AuctionStatus.FAILED;
      await this.auctionRepository.save(auction);
      this.gateway.emitAuctionUpdate(auction.id, {
        type: 'auction.closed',
        auctionId: auction.id,
        outcome: 'failed',
      });
      await this.scheduleAutopayRetry(auction.id, winnerUserId);
      await this.notifications
        .notifyWinner({
          winnerUserId,
          auctionId: auction.id,
          winningBidUsd,
          buyerFeeUsd: fees.buyerProcessingFeeUsd,
          shippingUsd: fees.shippingUsd,
          totalChargedUsd: fees.totalChargedUsd,
          chargeStatus: 'failed',
          orderId: null,
        })
        .catch(() => undefined);
      return;
    }

    if (intent.status === 'succeeded') {
      // Persist order + mark PAID
      const order = await this.createOrderForWinner({
        auction,
        winnerUserId,
        fees,
        paymentIntentId: intent.id,
      });

      auction.status = AuctionStatus.PAID;
      auction.winnerUserId = winnerUserId;
      auction.winningAmountUsd = fees.bidUsd.toFixed(2);
      auction.paidAt = new Date();
      auction.paymentIntentId = intent.id;
      auction.prizeOrderId = order.id;
      await this.auctionRepository.save(auction);

      // Decrement stock from 1 → 0 (auctions are 1-of-1).
      await this.prizeRepository.update(
        { id: auction.prizeConfigurationId },
        { stock: 0 },
      );

      this.gateway.emitAuctionUpdate(auction.id, {
        type: 'auction.closed',
        auctionId: auction.id,
        outcome: 'paid',
        winnerUserId,
        winningBidUsd: fees.bidUsd,
      });

      await Promise.allSettled([
        this.notifications.notifyWinner({
          winnerUserId,
          auctionId: auction.id,
          winningBidUsd: fees.bidUsd,
          buyerFeeUsd: fees.buyerProcessingFeeUsd,
          shippingUsd: fees.shippingUsd,
          totalChargedUsd: fees.totalChargedUsd,
          chargeStatus: 'charged',
          orderId: order.id,
        }),
        this.notifications.notifyLosers({
          auctionId: auction.id,
          winnerUserId,
          winningBidUsd: fees.bidUsd,
        }),
      ]);

      this.logger.log(
        `Auction ${auction.id} PAID: winner=${winnerUserId} bid=$${fees.bidUsd.toFixed(2)} total=$${fees.totalChargedUsd.toFixed(2)} sellerFee=$${fees.sellerFeeUsd.toFixed(2)} pi=${intent.id}`,
      );
      return;
    }

    // requires_action | requires_confirmation | processing → leave the
    // auction in ENDED with paymentIntentId set so admins can see it's
    // pending winner action. We do NOT schedule a runner-up retry here
    // because the winner can still complete authentication.
    this.logger.warn(
      `Auction ${auction.id} PaymentIntent ${intent.id} status=${intent.status}; pending winner action`,
    );
    auction.status = AuctionStatus.ENDED;
    auction.winnerUserId = winnerUserId;
    auction.winningAmountUsd = fees.bidUsd.toFixed(2);
    auction.paymentIntentId = intent.id;
    await this.auctionRepository.save(auction);
    this.gateway.emitAuctionUpdate(auction.id, {
      type: 'auction.closed',
      auctionId: auction.id,
      outcome: 'pending_payment',
      winnerUserId,
    });
    await this.notifications
      .notifyWinner({
        winnerUserId,
        auctionId: auction.id,
        winningBidUsd: fees.bidUsd,
        buyerFeeUsd: fees.buyerProcessingFeeUsd,
        shippingUsd: fees.shippingUsd,
        totalChargedUsd: fees.totalChargedUsd,
        chargeStatus: 'pending_action',
        orderId: null,
      })
      .catch(() => undefined);
  }

  /**
   * Create a `prize_orders` row for an auction win. Shipping address is
   * snapshotted from the winner's profile address (the same address
   * shown to them in the bid modal). Bidders are required to keep their
   * profile address current — they can update it inline from the bid
   * modal before placing a bid. `payment_method` is `'usd'` since
   * auctions are pure-USD.
   */
  private async createOrderForWinner(params: {
    auction: Auction;
    winnerUserId: string;
    fees: ReturnType<AuctionsService['computeAuctionFees']>;
    paymentIntentId: string;
  }): Promise<PrizeOrder> {
    const { auction, winnerUserId, fees, paymentIntentId } = params;

    // Snapshot the address now so subsequent profile edits don't
    // retroactively change where the prize was meant to ship. If the
    // user has somehow ended up with a partially-empty address (legacy
    // accounts pre-bid) we still create the order — admins can fill in
    // the gaps from the Auctions tab. Stripe charge succeeded so we'd
    // rather have a paid order with a half-empty address than refuse
    // to record the sale.
    const winner = await this.userRepository.findOne({
      where: { id: winnerUserId },
    });

    const order = this.orderRepository.create({
      userId: winnerUserId,
      prizeConfigurationId: auction.prizeConfigurationId,
      shippingAddress: {
        firstName: winner?.firstName ?? '',
        lastName: winner?.lastName ?? '',
        addressLine1: winner?.address ?? '',
        addressLine2: winner?.address2 ?? '',
        city: winner?.city ?? '',
        state: winner?.state ?? '',
        zipCode: winner?.zipCode ?? '',
        country: winner?.country ?? 'United States',
      },
      paymentMethod: 'usd' as const,
      coinsDeducted: 0,
      usdCharged: fees.totalChargedUsd.toFixed(2) as unknown as number,
      totalPrice: fees.totalChargedUsd.toFixed(2) as unknown as number,
      stripePaymentIntentId: paymentIntentId,
      status: 'paid',
    });
    return this.orderRepository.save(order);
  }

  /**
   * Schedule a 24h delayed job to attempt the runner-up after a winner
   * decline. Deterministic jobId so repeated declines don't double-book.
   */
  private async scheduleAutopayRetry(
    auctionId: string,
    excludeUserId: string,
  ): Promise<void> {
    const jobId = `auction-autopay-retry__${auctionId}`;
    await this.auctionQueue.remove(jobId).catch(() => undefined);
    await this.auctionQueue.add(
      AUCTION_AUTOPAY_RETRY_JOB,
      { auctionId, retryUserId: excludeUserId },
      {
        jobId,
        delay: 24 * 60 * 60 * 1000,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
    this.logger.log(
      `Scheduled autopay-retry for auction ${auctionId} in 24h, excluding user ${excludeUserId}`,
    );
  }
}
