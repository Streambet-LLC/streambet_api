import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  DataSource,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';
import Stripe from 'stripe';
import { Auction } from '../prize/entities/auction.entity';
import { AuctionBid } from '../prize/entities/auction-bid.entity';
import { AuctionCryptoDeposit } from '../prize/entities/auction-crypto-deposit.entity';
import { User } from '../users/entities/user.entity';
import { AuctionStatus } from '../prize/enums/auction-status.enum';
import { AuctionCategory } from '../prize/enums/auction-category.enum';
import { UserRole } from '../enums/user-role.enum';
import { CreateAuctionDto, UpdateAuctionDto } from './dto/create-auction.dto';
import {
  CryptoDepositConfirmDto,
  CryptoDepositQuoteDto,
  PlaceBidDto,
} from './dto/place-bid.dto';
import {
  AuctionsPaymentsService,
  StripeMethodKind,
} from './auctions-payments.service';
import { AuctionsCryptoService } from './auctions-crypto.service';
import { AuctionsGateway } from './auctions.gateway';
import { AuctionsNotificationsService } from './auctions-notifications.service';
import { AuctionSummaryDto } from '../prize/dto/prize-config.dto';
import {
  AUCTION_AUTOPAY_RETRY_JOB,
  AUCTION_CLOSE_JOB,
  AUCTION_CLOSING_SOON_JOB,
  AUCTION_ACTIVATE_JOB,
  AUCTION_QUEUE,
  AUCTION_RECONCILE_JOB,
  AUCTION_SWEEP_JOB,
} from '../common/constants/queue.constants';
import {
  ANTI_SNIPE_WINDOW_SECONDS,
  CARD_PROCESSING_FIXED_USD,
  CARD_PROCESSING_PERCENT,
  PAYMENT_GRACE_HOURS,
  minIncrementFor,
  minNextBid,
  round2,
  winTotals,
} from './hermes.pricing';
import {
  AcceptedPayments,
  AuctionBucket,
  AuctionFundingMethod,
  AuctionVideo,
  BUCKET_STATUSES,
  ShippingAddressSnapshot,
  bucketForStatus,
  methodsFor,
} from './hermes.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_LENGTH_MS = 60 * 60 * 1000;
const MAX_LENGTH_MS = 60 * DAY_MS;
/** A fresh USDC deposit gets this long to back a bid before it's refunded. */
const UNUSED_DEPOSIT_GRACE_MS = 20 * 60 * 1000;
/** Seller shown to bidders when an auction doesn't name one. */
const HOUSE_SELLER_NAME = 'Hermes Auctions';

/** "j***e" style handle so bidders are recognizable but not identifiable. */
export function maskHandle(username: string | null | undefined): string {
  const u = (username || 'bidder').trim();
  if (u.length <= 2) return `${u[0] ?? 'b'}***`;
  return `${u[0]}***${u[u.length - 1]}`;
}

export function toEmbed(
  kind: AuctionVideo['kind'],
  url: string,
): string | undefined {
  try {
    const u = new URL(url);
    if (kind === 'youtube') {
      const id = u.hostname.includes('youtu.be')
        ? u.pathname.slice(1)
        : u.searchParams.get('v') ||
          u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/)?.[1];
      return id && /^[\w-]{6,}$/.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : undefined;
    }
    if (kind === 'vimeo') {
      const id = u.pathname.match(/(\d{6,})/)?.[1];
      return id ? `https://player.vimeo.com/video/${id}` : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

type LeaderFunding = {
  fundingMethod: AuctionFundingMethod;
  stripePaymentMethodId: string | null;
  cryptoWallet: string | null;
};

/**
 * Hermes Auctions engine: lifecycle, proxy bidding, settlement.
 *
 * Concurrency: `placeBid` runs in a SERIALIZABLE transaction holding a row
 * lock on the auction, retried on serialization failures. Close/settle
 * "claim" the auction with a conditional status update so two workers can
 * never settle the same auction, and Stripe charges carry idempotency keys.
 *
 * Settlement by funding method:
 *  - card / ach → off-session PaymentIntent on the saved method; a decline
 *    or 3DS leaves a grace window, then the next bidder is offered it.
 *  - usdc → the winner's on-chain escrow pays hammer + shipping to the
 *    treasury; the remainder (their unused max) is returned.
 * Every non-winning USDC escrow is refunded as soon as it stops backing the
 * lead (see `reconcileCrypto`).
 */
@Injectable()
export class AuctionsService implements OnModuleInit {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    @InjectRepository(Auction)
    private readonly auctionRepository: Repository<Auction>,
    @InjectRepository(AuctionBid)
    private readonly bidRepository: Repository<AuctionBid>,
    @InjectRepository(AuctionCryptoDeposit)
    private readonly depositRepository: Repository<AuctionCryptoDeposit>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly paymentsService: AuctionsPaymentsService,
    private readonly crypto: AuctionsCryptoService,
    private readonly gateway: AuctionsGateway,
    private readonly notifications: AuctionsNotificationsService,
    @InjectQueue(AUCTION_QUEUE) private readonly auctionQueue: Queue,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Boot: sweeper + repeatable reconciliation
  // ─────────────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    try {
      await this.auctionQueue.upsertJobScheduler(
        'hermes-sweep',
        { every: 10 * 60 * 1000 },
        {
          name: AUCTION_SWEEP_JOB,
          data: { auctionId: 'all' },
          opts: { removeOnComplete: 50, removeOnFail: 50 },
        },
      );
    } catch (err) {
      this.logger.warn(
        `Could not register auction sweep: ${(err as Error).message}`,
      );
    }
    // Don't block boot on the catch-up sweep.
    void this.runSweep().catch((err) =>
      this.logger.error(
        `Initial auction sweep failed: ${(err as Error).message}`,
      ),
    );
  }

  /**
   * Catches anything a lost delayed job would have done: activates due
   * auctions, closes overdue ones, re-checks pending payments, and
   * reconciles USDC escrows. Every step is idempotent.
   */
  async runSweep(): Promise<void> {
    const now = new Date();
    const overdue = await this.auctionRepository.find({
      where: [
        { status: AuctionStatus.ACTIVE, endsAt: LessThan(now) },
        { status: AuctionStatus.SCHEDULED, endsAt: LessThan(now) },
      ],
      select: ['id'],
    });
    for (const a of overdue) {
      await this.runCloseJob(a.id).catch((err) =>
        this.logger.error(
          `Sweep close ${a.id} failed: ${(err as Error).message}`,
        ),
      );
    }

    const due = await this.auctionRepository.find({
      where: {
        status: AuctionStatus.SCHEDULED,
        startsAt: LessThanOrEqual(now),
        endsAt: MoreThan(now),
      },
      select: ['id'],
    });
    for (const a of due) {
      await this.runActivateJob(a.id).catch(() => undefined);
    }

    const pending = await this.auctionRepository.find({
      where: [
        { status: AuctionStatus.ENDED },
        { status: AuctionStatus.FAILED },
      ],
    });
    for (const a of pending) {
      await this.refreshPendingPayment(a).catch((err) =>
        this.logger.warn(
          `Sweep payment ${a.id} failed: ${(err as Error).message}`,
        ),
      );
    }

    if (this.crypto.isEnabled()) {
      const held = await this.depositRepository
        .createQueryBuilder('d')
        .select('DISTINCT d.auction_id', 'auctionId')
        .where("d.status = 'held'")
        .getRawMany<{ auctionId: string }>();
      for (const h of held) {
        await this.reconcileCrypto(h.auctionId).catch((err) =>
          this.logger.warn(
            `Sweep reconcile ${h.auctionId}: ${(err as Error).message}`,
          ),
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Admin: create / update / cancel / ship
  // ─────────────────────────────────────────────────────────────────────

  private resolveTiming(dto: {
    startsAt?: string;
    lengthPreset: string;
    endsAt?: string;
  }): { startsAt: Date; endsAt: Date; durationDays: number | null } {
    const now = Date.now();
    let start = dto.startsAt ? new Date(dto.startsAt) : new Date(now);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Invalid start date.');
    }
    if (start.getTime() < now) start = new Date(now);
    if (start.getTime() > now + 365 * DAY_MS) {
      throw new BadRequestException('Start date must be within the next year.');
    }

    let end: Date;
    let durationDays: number | null = null;
    if (dto.lengthPreset === 'custom') {
      if (!dto.endsAt) {
        throw new BadRequestException('Pick an end date for a custom length.');
      }
      end = new Date(dto.endsAt);
      if (Number.isNaN(end.getTime())) {
        throw new BadRequestException('Invalid end date.');
      }
    } else {
      durationDays = Number(dto.lengthPreset);
      end = new Date(start.getTime() + durationDays * DAY_MS);
    }

    const len = end.getTime() - start.getTime();
    if (len < MIN_LENGTH_MS) {
      throw new BadRequestException('Auctions must run at least 1 hour.');
    }
    if (len > MAX_LENGTH_MS) {
      throw new BadRequestException('Auctions can run at most 60 days.');
    }
    return { startsAt: start, endsAt: end, durationDays };
  }

  private normalizeVideos(videos: CreateAuctionDto['videos']): AuctionVideo[] {
    return (videos ?? []).map((v) => {
      if (v.kind === 'upload')
        return { kind: 'upload', url: v.url, key: v.key };
      const embedUrl = toEmbed(v.kind, v.url);
      if (!embedUrl) {
        throw new BadRequestException(
          `That doesn't look like a ${v.kind} video link.`,
        );
      }
      return { kind: v.kind, url: v.url, embedUrl };
    });
  }

  /** Crypto-only lots need the escrow live, or nobody could bid on them. */
  private assertPaymentsAvailable(accepted: AcceptedPayments): void {
    if (accepted === 'crypto' && !this.crypto.isEnabled()) {
      throw new BadRequestException(
        "USDC escrow isn't live yet, so a crypto-only auction couldn't take bids. Choose Fiat or Both.",
      );
    }
  }

  private assertReserve(starting: number, reserve: number | null | undefined) {
    if (reserve != null && reserve < starting) {
      throw new BadRequestException(
        'Reserve price cannot be less than the starting bid.',
      );
    }
  }

  async createAuction(
    adminId: string,
    dto: CreateAuctionDto,
  ): Promise<Auction> {
    if (!dto.images?.length) {
      throw new BadRequestException('Add at least one photo.');
    }
    this.assertReserve(dto.startingPriceUsd, dto.reservePriceUsd);
    const acceptedPayments = dto.acceptedPayments ?? 'both';
    this.assertPaymentsAvailable(acceptedPayments);
    const timing = this.resolveTiming(dto);
    const status =
      timing.startsAt.getTime() <= Date.now() + 5_000
        ? AuctionStatus.ACTIVE
        : AuctionStatus.SCHEDULED;

    const saved = await this.auctionRepository.save(
      this.auctionRepository.create({
        prizeConfigurationId: null,
        title: dto.title.trim(),
        description: dto.description ?? '',
        category: dto.category,
        images: dto.images.map((i) => ({ key: i.key, url: i.url })),
        videos: this.normalizeVideos(dto.videos),
        lengthPreset: dto.lengthPreset,
        durationDays: timing.durationDays,
        startsAt: timing.startsAt,
        endsAt: timing.endsAt,
        status,
        startingPriceUsd: dto.startingPriceUsd.toFixed(2),
        reservePriceUsd:
          dto.reservePriceUsd != null ? dto.reservePriceUsd.toFixed(2) : null,
        estValueUsd:
          dto.estValueUsd != null ? dto.estValueUsd.toFixed(2) : null,
        estValueSource:
          dto.estValueUsd != null ? (dto.estValueSource ?? 'manual') : null,
        estValueMeta:
          (dto.estValueMeta as unknown as Auction['estValueMeta']) ?? null,
        shippingUsd: dto.shippingUsd.toFixed(2),
        isFeatured: !!dto.isFeatured,
        showEstValue: dto.showEstValue ?? true,
        sellerName: dto.sellerName?.trim() || null,
        acceptedPayments,
        currentBidUsd: null,
        currentLeaderUserId: null,
        proxyMaxUsd: null,
        bidCount: 0,
        extensionCount: 0,
        declinedUserIds: [],
        createdBy: adminId,
      }),
    );

    try {
      await this.scheduleAuctionJobs(saved.id, saved.endsAt);
    } catch (err) {
      // Without jobs the sweeper still closes it, but tell the admin now.
      this.logger.error(
        `Scheduling jobs for ${saved.id} failed: ${(err as Error).message}`,
      );
    }
    this.logger.log(
      `Hermes auction ${saved.id} created by ${adminId} (${saved.status})`,
    );
    return saved;
  }

  async updateAuction(
    adminId: string,
    id: string,
    dto: UpdateAuctionDto,
  ): Promise<Auction> {
    const a = await this.auctionRepository.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Auction not found');
    if (a.status === AuctionStatus.CANCELLED) {
      throw new BadRequestException('Cancelled auctions cannot be edited.');
    }

    // Content can change at any time.
    if (dto.title !== undefined) a.title = dto.title.trim();
    if (dto.description !== undefined) a.description = dto.description;
    if (dto.images !== undefined) {
      if (!dto.images.length)
        throw new BadRequestException('Keep at least one photo.');
      a.images = dto.images.map((i) => ({ key: i.key, url: i.url }));
    }
    if (dto.videos !== undefined) a.videos = this.normalizeVideos(dto.videos);
    if (dto.isFeatured !== undefined) a.isFeatured = dto.isFeatured;
    if (dto.showEstValue !== undefined) a.showEstValue = dto.showEstValue;
    if (dto.sellerName !== undefined)
      a.sellerName = dto.sellerName?.trim() || null;
    if (dto.estValueUsd !== undefined) {
      a.estValueUsd =
        dto.estValueUsd != null ? dto.estValueUsd.toFixed(2) : null;
      a.estValueSource =
        dto.estValueUsd != null ? (dto.estValueSource ?? 'manual') : null;
      a.estValueMeta =
        dto.estValueUsd != null
          ? ((dto.estValueMeta as unknown as Auction['estValueMeta']) ?? null)
          : null;
    }
    if (dto.category !== undefined) a.category = dto.category;

    // Terms that bidders rely on are frozen once bidding opens.
    const termsTouched =
      dto.startingPriceUsd !== undefined ||
      dto.reservePriceUsd !== undefined ||
      dto.shippingUsd !== undefined ||
      dto.acceptedPayments !== undefined ||
      dto.startsAt !== undefined ||
      dto.lengthPreset !== undefined ||
      dto.endsAt !== undefined;
    let reschedule = false;
    if (termsTouched) {
      if (a.status !== AuctionStatus.SCHEDULED) {
        throw new BadRequestException(
          'Price, reserve, shipping, payment options and timing are locked once an auction is live.',
        );
      }
      if (dto.acceptedPayments !== undefined) {
        this.assertPaymentsAvailable(dto.acceptedPayments);
        a.acceptedPayments = dto.acceptedPayments;
      }
      const starting = dto.startingPriceUsd ?? Number(a.startingPriceUsd);
      const reserve =
        dto.reservePriceUsd !== undefined
          ? dto.reservePriceUsd
          : a.reservePriceUsd != null
            ? Number(a.reservePriceUsd)
            : null;
      this.assertReserve(starting, reserve);
      a.startingPriceUsd = starting.toFixed(2);
      a.reservePriceUsd = reserve != null ? reserve.toFixed(2) : null;
      if (dto.shippingUsd !== undefined)
        a.shippingUsd = dto.shippingUsd.toFixed(2);

      if (
        dto.startsAt !== undefined ||
        dto.lengthPreset !== undefined ||
        dto.endsAt !== undefined
      ) {
        const timing = this.resolveTiming({
          startsAt: dto.startsAt ?? a.startsAt.toISOString(),
          lengthPreset: dto.lengthPreset ?? a.lengthPreset ?? 'custom',
          endsAt: dto.endsAt ?? a.endsAt.toISOString(),
        });
        a.startsAt = timing.startsAt;
        a.endsAt = timing.endsAt;
        a.durationDays = timing.durationDays;
        a.lengthPreset = dto.lengthPreset ?? a.lengthPreset;
        if (a.startsAt.getTime() <= Date.now() + 5_000)
          a.status = AuctionStatus.ACTIVE;
        reschedule = true;
      }
    }

    const saved = await this.auctionRepository.save(a);
    if (reschedule) await this.scheduleAuctionJobs(saved.id, saved.endsAt);
    this.gateway.emitAuctionUpdate(saved.id, {
      type: 'auction.updated',
      auctionId: saved.id,
    });
    this.logger.log(`Hermes auction ${id} updated by ${adminId}`);
    return saved;
  }

  async cancelAuction(adminId: string, id: string): Promise<Auction> {
    const a = await this.auctionRepository.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Auction not found');
    if (a.status === AuctionStatus.PAID) {
      throw new BadRequestException(
        'Cannot cancel a paid auction — refund it in Stripe first.',
      );
    }
    if (a.status === AuctionStatus.CANCELLED) return a;
    a.status = AuctionStatus.CANCELLED;
    const saved = await this.auctionRepository.save(a);
    await this.removeAuctionJobs(a.id);
    this.gateway.emitAuctionUpdate(a.id, {
      type: 'auction.cancelled',
      auctionId: a.id,
    });
    await this.enqueueReconcile(a.id, 0);
    this.logger.log(`Hermes auction ${a.id} cancelled by ${adminId}`);
    return saved;
  }

  async forceClose(adminId: string, id: string): Promise<Auction> {
    const a = await this.auctionRepository.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Auction not found');
    if (
      a.status !== AuctionStatus.ACTIVE &&
      a.status !== AuctionStatus.SCHEDULED
    ) {
      throw new BadRequestException(
        'Only live or upcoming auctions can be closed early.',
      );
    }
    a.endsAt = new Date();
    await this.auctionRepository.save(a);
    await this.removeAuctionJobs(a.id);
    this.logger.log(`Hermes auction ${a.id} force-closed by ${adminId}`);
    await this.runCloseJob(a.id);
    return this.getOrThrow(a.id);
  }

  async markShipped(
    id: string,
    body: { carrier: string; trackingNumber: string },
  ): Promise<Auction> {
    const a = await this.getOrThrow(id);
    if (a.status !== AuctionStatus.PAID) {
      throw new BadRequestException(
        'Only paid auctions can be marked shipped.',
      );
    }
    a.fulfillmentStatus = 'shipped';
    a.carrier = body.carrier.trim();
    a.trackingNumber = body.trackingNumber.trim();
    a.shippedAt = new Date();
    const saved = await this.auctionRepository.save(a);
    void this.notifications.notifyShipped(saved);
    return saved;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────────

  private async getOrThrow(id: string): Promise<Auction> {
    const a = await this.auctionRepository.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Auction not found');
    return a;
  }

  /** Hermes rows only — legacy shop auctions have no title. */
  private hermesOnly() {
    return 'a.title IS NOT NULL';
  }

  async listPublic(params: {
    bucket: 'live' | 'upcoming';
    category?: AuctionCategory;
    viewerId?: string;
    limit?: number;
  }) {
    const qb = this.auctionRepository
      .createQueryBuilder('a')
      .where(this.hermesOnly())
      .andWhere('a.status IN (:...statuses)', {
        statuses: BUCKET_STATUSES[params.bucket],
      });
    if (params.category)
      qb.andWhere('a.category = :cat', { cat: params.category });
    qb.orderBy(
      params.bucket === 'live' ? 'a.endsAt' : 'a.startsAt',
      'ASC',
    ).take(Math.min(params.limit ?? 60, 100));
    const rows = await qb.getMany();
    return this.toPublicMany(rows, params.viewerId);
  }

  /** Landing-page rail: featured first, then live soonest-ending, then upcoming. */
  async listFeatured(limit = 6, viewerId?: string) {
    const rows = await this.auctionRepository
      .createQueryBuilder('a')
      .where(this.hermesOnly())
      .andWhere('a.status IN (:...statuses)', {
        statuses: [AuctionStatus.ACTIVE, AuctionStatus.SCHEDULED],
      })
      .orderBy('a.isFeatured', 'DESC')
      .addOrderBy(`CASE WHEN a.status = 'active' THEN 0 ELSE 1 END`, 'ASC')
      .addOrderBy('a.endsAt', 'ASC')
      .take(Math.min(limit, 12))
      .getMany();
    return this.toPublicMany(rows, viewerId);
  }

  async getPublic(id: string, viewerId?: string) {
    const a = await this.getOrThrow(id);
    if (!a.title) throw new NotFoundException('Auction not found');
    const [dto] = await this.toPublicMany([a], viewerId);
    return dto;
  }

  async getPublicBids(id: string) {
    const rows = await this.bidRepository
      .createQueryBuilder('b')
      .leftJoin(User, 'u', 'u.id = b.user_id')
      .select([
        'b.id AS id',
        'u.username AS username',
        'b.amount_usd AS "amountUsd"',
        'b.is_proxy_auto AS "isAuto"',
        'b."createdAt" AS "createdAt"',
      ])
      .where('b.auction_id = :id', { id })
      .orderBy('b."createdAt"', 'DESC')
      .addOrderBy('b.amount_usd', 'DESC')
      .limit(100)
      .getRawMany<{
        id: string;
        username: string | null;
        amountUsd: string;
        isAuto: boolean;
        createdAt: Date;
      }>();
    return rows.map((r) => ({
      id: r.id,
      bidder: maskHandle(r.username),
      amountUsd: Number(r.amountUsd),
      isAuto: r.isAuto,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  private async toPublicMany(rows: Auction[], viewerId?: string) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const leaderIds = [
      ...new Set(
        rows.map((r) => r.currentLeaderUserId).filter((v): v is string => !!v),
      ),
    ];
    const winnerIds = [
      ...new Set(
        rows.map((r) => r.winnerUserId).filter((v): v is string => !!v),
      ),
    ];
    const users =
      leaderIds.length || winnerIds.length
        ? await this.userRepository.find({
            where: { id: In([...leaderIds, ...winnerIds]) },
            select: ['id', 'username'],
          })
        : [];
    const nameOf = new Map(users.map((u) => [u.id, u.username]));

    let viewerBids = new Map<
      string,
      { max: number; funding: AuctionFundingMethod }
    >();
    let viewerDeposits = new Map<string, number>();
    if (viewerId) {
      const bids = await this.bidRepository
        .createQueryBuilder('b')
        .select('b.auction_id', 'auctionId')
        .addSelect('MAX(b.proxy_max_usd)', 'max')
        .addSelect(
          `(ARRAY_AGG(b.funding_method ORDER BY b."createdAt" DESC))[1]`,
          'funding',
        )
        .where('b.user_id = :uid', { uid: viewerId })
        .andWhere('b.auction_id IN (:...ids)', { ids })
        .andWhere('b.is_proxy_auto = false')
        .groupBy('b.auction_id')
        .getRawMany<{
          auctionId: string;
          max: string;
          funding: AuctionFundingMethod;
        }>();
      viewerBids = new Map(
        bids.map((b) => [
          b.auctionId,
          { max: Number(b.max), funding: b.funding },
        ]),
      );
      const deps = await this.depositRepository.find({
        where: { userId: viewerId, auctionId: In(ids), status: 'held' },
      });
      viewerDeposits = new Map(
        deps.map((d) => [d.auctionId, Number(d.amountUsd)]),
      );
    }

    return rows.map((a) => {
      const current = a.currentBidUsd != null ? Number(a.currentBidUsd) : null;
      const start = Number(a.startingPriceUsd);
      const reserve =
        a.reservePriceUsd != null ? Number(a.reservePriceUsd) : null;
      const isLeader = !!viewerId && a.currentLeaderUserId === viewerId;
      const mine = viewerBids.get(a.id);
      const settled = bucketForStatus(a.status) === 'settled';
      return {
        id: a.id,
        title: a.title,
        description: a.description,
        category: a.category,
        images: a.images ?? [],
        videos: (a.videos ?? []).map((v) => ({
          kind: v.kind,
          url: v.url,
          embedUrl: v.embedUrl ?? null,
        })),
        status: a.status,
        bucket: bucketForStatus(a.status),
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        lengthPreset: a.lengthPreset,
        startingPriceUsd: start,
        currentBidUsd: current,
        minNextBidUsd: minNextBid(current, start),
        minIncrementUsd: minIncrementFor(current ?? start),
        bidCount: a.bidCount,
        extensionCount: a.extensionCount,
        hasReserve: reserve !== null,
        reserveMet:
          reserve === null ? null : current !== null && current >= reserve,
        // Hidden Est. Value never leaves the server for bidders.
        estValueUsd:
          a.showEstValue !== false && a.estValueUsd != null
            ? Number(a.estValueUsd)
            : null,
        estValueSource: a.showEstValue !== false ? a.estValueSource : null,
        sellerName: a.sellerName || HOUSE_SELLER_NAME,
        acceptedPayments: a.acceptedPayments ?? 'both',
        acceptedMethods: methodsFor(a.acceptedPayments ?? 'both'),
        shippingUsd: Number(a.shippingUsd ?? 0),
        isFeatured: a.isFeatured,
        leader: a.currentLeaderUserId
          ? maskHandle(nameOf.get(a.currentLeaderUserId))
          : null,
        result: settled
          ? {
              sold:
                a.status === AuctionStatus.PAID ||
                a.status === AuctionStatus.ENDED,
              winningBidUsd:
                a.winningAmountUsd != null ? Number(a.winningAmountUsd) : null,
              winner: a.winnerUserId
                ? maskHandle(nameOf.get(a.winnerUserId))
                : null,
            }
          : null,
        viewer: viewerId
          ? {
              isLeader,
              isBidder: !!mine,
              isWinner: a.winnerUserId === viewerId,
              myMaxUsd:
                isLeader && a.proxyMaxUsd
                  ? Number(a.proxyMaxUsd)
                  : (mine?.max ?? null),
              fundingMethod: mine?.funding ?? null,
              escrowUsd: viewerDeposits.get(a.id) ?? null,
            }
          : null,
        fees: {
          buyerPremiumPercent: 0,
          cardProcessingPercent: CARD_PROCESSING_PERCENT,
          cardProcessingFixedUsd: CARD_PROCESSING_FIXED_USD,
        },
      };
    });
  }

  // Admin listing / detail ──────────────────────────────────────────────

  async listAdmin(bucket: AuctionBucket) {
    const rows = await this.auctionRepository
      .createQueryBuilder('a')
      .where(this.hermesOnly())
      .andWhere('a.status IN (:...statuses)', {
        statuses: BUCKET_STATUSES[bucket],
      })
      .orderBy(
        bucket === 'upcoming' ? 'a.startsAt' : 'a.endsAt',
        bucket === 'settled' ? 'DESC' : 'ASC',
      )
      .take(200)
      .getMany();
    const userIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.currentLeaderUserId, r.winnerUserId])
          .filter((v): v is string => !!v),
      ),
    ];
    const users = userIds.length
      ? await this.userRepository.find({
          where: { id: In(userIds) },
          select: ['id', 'username'],
        })
      : [];
    const name = new Map(users.map((u) => [u.id, u.username]));
    const now = Date.now();
    return rows.map((a) => ({
      id: a.id,
      title: a.title,
      category: a.category,
      image: a.images?.[0]?.url ?? null,
      status: a.status,
      bucket: bucketForStatus(a.status),
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      startingPriceUsd: Number(a.startingPriceUsd),
      reservePriceUsd:
        a.reservePriceUsd != null ? Number(a.reservePriceUsd) : null,
      currentBidUsd: a.currentBidUsd != null ? Number(a.currentBidUsd) : null,
      estValueUsd: a.estValueUsd != null ? Number(a.estValueUsd) : null,
      bidCount: a.bidCount,
      leader: a.currentLeaderUserId
        ? (name.get(a.currentLeaderUserId) ?? null)
        : null,
      winner: a.winnerUserId ? (name.get(a.winnerUserId) ?? null) : null,
      winningAmountUsd:
        a.winningAmountUsd != null ? Number(a.winningAmountUsd) : null,
      paymentMethod: a.paymentMethod,
      fulfillmentStatus: a.fulfillmentStatus,
      isFeatured: a.isFeatured,
      showEstValue: a.showEstValue !== false,
      sellerName: a.sellerName || HOUSE_SELLER_NAME,
      acceptedPayments: a.acceptedPayments ?? 'both',
      isOverdue:
        (a.status === AuctionStatus.ACTIVE ||
          a.status === AuctionStatus.SCHEDULED) &&
        a.endsAt.getTime() < now,
    }));
  }

  async getAdminDetail(id: string) {
    const a = await this.getOrThrow(id);
    const bids = await this.bidRepository
      .createQueryBuilder('b')
      .leftJoin(User, 'u', 'u.id = b.user_id')
      .select([
        'b.id AS id',
        'b.user_id AS "userId"',
        'u.username AS username',
        'u.email AS email',
        'b.amount_usd AS "amountUsd"',
        'b.proxy_max_usd AS "proxyMaxUsd"',
        'b.is_proxy_auto AS "isAuto"',
        'b.funding_method AS "fundingMethod"',
        'b."createdAt" AS "createdAt"',
      ])
      .where('b.auction_id = :id', { id })
      .orderBy('b."createdAt"', 'DESC')
      .getRawMany<{
        id: string;
        userId: string;
        username: string | null;
        email: string | null;
        amountUsd: string;
        proxyMaxUsd: string;
        isAuto: boolean;
        fundingMethod: AuctionFundingMethod;
        createdAt: Date;
      }>();
    const deposits = await this.depositRepository.find({
      where: { auctionId: id },
    });
    const winner = a.winnerUserId
      ? await this.userRepository.findOne({
          where: { id: a.winnerUserId },
          select: ['id', 'username', 'email'],
        })
      : null;
    return {
      auction: {
        ...a,
        startingPriceUsd: Number(a.startingPriceUsd),
        reservePriceUsd:
          a.reservePriceUsd != null ? Number(a.reservePriceUsd) : null,
        currentBidUsd: a.currentBidUsd != null ? Number(a.currentBidUsd) : null,
        proxyMaxUsd: a.proxyMaxUsd != null ? Number(a.proxyMaxUsd) : null,
        estValueUsd: a.estValueUsd != null ? Number(a.estValueUsd) : null,
        shippingUsd: Number(a.shippingUsd ?? 0),
        winningAmountUsd:
          a.winningAmountUsd != null ? Number(a.winningAmountUsd) : null,
        cardFeeUsd: a.cardFeeUsd != null ? Number(a.cardFeeUsd) : null,
        totalChargedUsd:
          a.totalChargedUsd != null ? Number(a.totalChargedUsd) : null,
        bucket: bucketForStatus(a.status),
      },
      winner,
      bids: bids.map((b) => ({
        ...b,
        amountUsd: Number(b.amountUsd),
        proxyMaxUsd: Number(b.proxyMaxUsd),
        createdAt: new Date(b.createdAt).toISOString(),
      })),
      deposits: deposits.map((d) => ({
        id: d.id,
        userId: d.userId,
        wallet: d.wallet,
        escrow: d.escrowAddress,
        amountUsd: Number(d.amountUsd),
        status: d.status,
        refundSignature: d.refundSignature,
        settleSignature: d.settleSignature,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Bidding
  // ─────────────────────────────────────────────────────────────────────

  private hasShippingAddress(u: User): boolean {
    return !!(
      u.firstName &&
      u.lastName &&
      u.address &&
      u.city &&
      u.state &&
      u.zipCode
    );
  }

  private async withSerializableRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const code =
          (err as { code?: string; driverError?: { code?: string } })?.code ??
          (err as { driverError?: { code?: string } })?.driverError?.code;
        if (code === '40001' && attempt < 4) {
          await new Promise((r) => setTimeout(r, 25 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  async placeBid(userId: string, auctionId: string, dto: PlaceBidDto) {
    const proxyMax = round2(dto.proxyMaxUsd);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new ForbiddenException('Sign in to bid.');
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'House accounts cannot bid on Hermes auctions.',
      );
    }
    if (!this.hasShippingAddress(user)) {
      throw new BadRequestException('Add a shipping address before bidding.');
    }
    const pre = await this.getOrThrow(auctionId);
    if (
      !methodsFor(pre.acceptedPayments ?? 'both').includes(dto.fundingMethod)
    ) {
      throw new BadRequestException(
        pre.acceptedPayments === 'crypto'
          ? 'This auction only accepts USDC.'
          : 'This auction only accepts card or bank (ACH) payments.',
      );
    }

    const funding: LeaderFunding = {
      fundingMethod: dto.fundingMethod,
      stripePaymentMethodId: null,
      cryptoWallet: null,
    };
    if (dto.fundingMethod === 'usdc') {
      const dep = await this.depositRepository.findOne({
        where: { auctionId, userId, status: 'held' },
      });
      if (!dep) {
        throw new BadRequestException(
          'Deposit USDC into escrow before bidding with USDC.',
        );
      }
      const onChain = await this.crypto.escrowBalanceUsd(auctionId, dep.wallet);
      if (onChain === null) {
        throw new BadRequestException(
          'Your USDC escrow was not found on-chain.',
        );
      }
      if (onChain !== Number(dep.amountUsd)) {
        dep.amountUsd = onChain.toFixed(2);
        await this.depositRepository.save(dep);
      }
      // A USDC win settles hammer + shipping from escrow, so both must fit.
      const shipping = Number(pre.shippingUsd ?? 0);
      if (round2(proxyMax + shipping) > onChain) {
        throw new BadRequestException(
          `Your escrow ($${onChain.toFixed(2)}) must cover your max bid plus $${shipping.toFixed(2)} shipping. Add more USDC first.`,
        );
      }
      funding.cryptoWallet = dep.wallet;
    } else {
      funding.stripePaymentMethodId =
        await this.paymentsService.resolveMethodForBid(
          userId,
          dto.fundingMethod,
          dto.stripePaymentMethodId,
        );
    }

    const result = await this.withSerializableRetry(() =>
      this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const auctionRepo = manager.getRepository(Auction);
        const bidRepo = manager.getRepository(AuctionBid);
        const auction = await auctionRepo
          .createQueryBuilder('a')
          .setLock('pessimistic_write')
          .where('a.id = :id', { id: auctionId })
          .getOne();
        if (!auction || !auction.title)
          throw new NotFoundException('Auction not found');

        if (
          auction.status === AuctionStatus.SCHEDULED &&
          auction.startsAt.getTime() <= Date.now()
        ) {
          auction.status = AuctionStatus.ACTIVE;
        }
        if (auction.status !== AuctionStatus.ACTIVE) {
          throw new BadRequestException(
            auction.status === AuctionStatus.SCHEDULED
              ? 'Bidding has not opened yet.'
              : 'This auction is closed.',
          );
        }
        const now = Date.now();
        if (auction.endsAt.getTime() <= now) {
          throw new BadRequestException('This auction has ended.');
        }

        // Anti-snipe: always leave a full window to respond.
        let extended = false;
        if (
          auction.endsAt.getTime() - now <=
          ANTI_SNIPE_WINDOW_SECONDS * 1000
        ) {
          auction.endsAt = new Date(now + ANTI_SNIPE_WINDOW_SECONDS * 1000);
          auction.extensionCount += 1;
          extended = true;
        }

        const start = Number(auction.startingPriceUsd);
        const currentVisible =
          auction.currentBidUsd != null ? Number(auction.currentBidUsd) : null;
        const leaderProxy =
          auction.proxyMaxUsd != null ? Number(auction.proxyMaxUsd) : null;
        const previousLeaderId = auction.currentLeaderUserId;
        const row = (fields: Partial<AuctionBid>) =>
          bidRepo.create({
            auctionId: auction.id,
            userId,
            isProxyAuto: false,
            ...funding,
            ...fields,
          });

        // Leader raising their own max: visible price doesn't move.
        if (previousLeaderId === userId) {
          if (leaderProxy !== null && proxyMax <= leaderProxy) {
            throw new BadRequestException(
              `Your new max must be higher than your current max ($${leaderProxy.toFixed(2)}).`,
            );
          }
          const bid = await bidRepo.save(
            row({
              amountUsd: (currentVisible ?? start).toFixed(2),
              proxyMaxUsd: proxyMax.toFixed(2),
            }),
          );
          auction.proxyMaxUsd = proxyMax.toFixed(2);
          auction.bidCount += 1;
          return {
            auction: await auctionRepo.save(auction),
            bid,
            previousLeaderId,
            extended,
          };
        }

        const required = minNextBid(currentVisible, start);
        if (proxyMax < required) {
          throw new BadRequestException(
            `Bid must be at least $${required.toFixed(2)}.`,
          );
        }

        let newVisible: number;
        let newLeaderId: string;
        let newProxy: number;
        let autoCounter: number | null = null;

        if (
          currentVisible === null ||
          leaderProxy === null ||
          !previousLeaderId
        ) {
          newVisible = start;
          newLeaderId = userId;
          newProxy = proxyMax;
        } else if (leaderProxy >= proxyMax) {
          // Existing leader's proxy holds; it counters just above the challenger.
          newLeaderId = previousLeaderId;
          newVisible = Math.min(
            leaderProxy,
            round2(proxyMax + minIncrementFor(proxyMax)),
          );
          newProxy = leaderProxy;
          autoCounter = newVisible;
        } else {
          // Challenger takes the lead one increment above the old max.
          newLeaderId = userId;
          newVisible = Math.min(
            proxyMax,
            round2(leaderProxy + minIncrementFor(leaderProxy)),
          );
          newProxy = proxyMax;
          autoCounter = leaderProxy;
        }

        const bid = await bidRepo.save(
          row({
            amountUsd: (newLeaderId === userId ? newVisible : proxyMax).toFixed(
              2,
            ),
            proxyMaxUsd: proxyMax.toFixed(2),
          }),
        );
        if (autoCounter !== null && previousLeaderId) {
          const prevFunding = await bidRepo.findOne({
            where: {
              auctionId: auction.id,
              userId: previousLeaderId,
              isProxyAuto: false,
            },
            order: { createdAt: 'DESC' },
          });
          await bidRepo.save(
            bidRepo.create({
              auctionId: auction.id,
              userId: previousLeaderId,
              amountUsd: autoCounter.toFixed(2),
              proxyMaxUsd: (leaderProxy ?? autoCounter).toFixed(2),
              isProxyAuto: true,
              fundingMethod: prevFunding?.fundingMethod ?? 'card',
              stripePaymentMethodId: prevFunding?.stripePaymentMethodId ?? null,
              cryptoWallet: prevFunding?.cryptoWallet ?? null,
            }),
          );
        }

        auction.currentBidUsd = newVisible.toFixed(2);
        auction.currentLeaderUserId = newLeaderId;
        auction.proxyMaxUsd = newProxy.toFixed(2);
        auction.bidCount += autoCounter !== null ? 2 : 1;
        return {
          auction: await auctionRepo.save(auction),
          bid,
          previousLeaderId,
          extended,
        };
      }),
    );

    const a = result.auction;
    const leader = await this.userRepository.findOne({
      where: { id: a.currentLeaderUserId },
      select: ['id', 'username'],
    });
    this.gateway.emitAuctionUpdate(a.id, {
      type: 'bid.placed',
      auctionId: a.id,
      currentBidUsd: Number(a.currentBidUsd),
      leader: maskHandle(leader?.username),
      bidCount: a.bidCount,
      endsAt: a.endsAt.toISOString(),
    });
    if (result.extended) {
      this.gateway.emitAuctionUpdate(a.id, {
        type: 'auction.extended',
        auctionId: a.id,
        endsAt: a.endsAt.toISOString(),
        extensionCount: a.extensionCount,
      });
      await this.scheduleAuctionJobs(a.id, a.endsAt).catch((err) =>
        this.logger.warn(
          `Reschedule after extension failed: ${(err as Error).message}`,
        ),
      );
    }
    if (
      result.previousLeaderId &&
      result.previousLeaderId !== a.currentLeaderUserId
    ) {
      void this.notifications.notifyOutbid({
        previousLeaderUserId: result.previousLeaderId,
        auctionId: a.id,
      });
    }
    await this.enqueueReconcile(a.id);

    return {
      leading: a.currentLeaderUserId === userId,
      currentBidUsd: Number(a.currentBidUsd),
      myMaxUsd: proxyMax,
      endsAt: a.endsAt.toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Jobs
  // ─────────────────────────────────────────────────────────────────────

  async scheduleAuctionJobs(auctionId: string, endsAt: Date): Promise<void> {
    // BullMQ job ids can't contain ':'.
    const closeJobId = `auction-close__${auctionId}`;
    const soonJobId = `auction-closing-soon__${auctionId}`;
    const activateJobId = `auction-activate__${auctionId}`;
    const now = Date.now();
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
      select: ['id', 'startsAt', 'status'],
    });

    await Promise.allSettled([
      this.auctionQueue.remove(closeJobId),
      this.auctionQueue.remove(soonJobId),
      this.auctionQueue.remove(activateJobId),
    ]);

    const opts = { removeOnComplete: 1000, removeOnFail: 1000 };
    await this.auctionQueue.add(
      AUCTION_CLOSE_JOB,
      { auctionId },
      {
        ...opts,
        jobId: closeJobId,
        delay: Math.max(0, endsAt.getTime() - now),
      },
    );
    if (endsAt.getTime() - now > 65 * 60 * 1000) {
      await this.auctionQueue.add(
        AUCTION_CLOSING_SOON_JOB,
        { auctionId },
        {
          ...opts,
          jobId: soonJobId,
          delay: endsAt.getTime() - 60 * 60 * 1000 - now,
        },
      );
    }
    if (
      auction?.status === AuctionStatus.SCHEDULED &&
      auction.startsAt.getTime() > now
    ) {
      await this.auctionQueue.add(
        AUCTION_ACTIVATE_JOB,
        { auctionId },
        {
          ...opts,
          jobId: activateJobId,
          delay: auction.startsAt.getTime() - now,
        },
      );
    }
  }

  async removeAuctionJobs(auctionId: string): Promise<void> {
    await Promise.allSettled([
      this.auctionQueue.remove(`auction-close__${auctionId}`),
      this.auctionQueue.remove(`auction-closing-soon__${auctionId}`),
      this.auctionQueue.remove(`auction-activate__${auctionId}`),
      this.auctionQueue.remove(`auction-autopay-retry__${auctionId}`),
    ]);
  }

  private async enqueueReconcile(
    auctionId: string,
    delayMs = 3_000,
  ): Promise<void> {
    if (!this.crypto.isEnabled()) return;
    const jobId = `auction-reconcile__${auctionId}__${Math.floor(Date.now() / 5_000)}`;
    await this.auctionQueue
      .add(
        AUCTION_RECONCILE_JOB,
        { auctionId },
        { jobId, delay: delayMs, removeOnComplete: 500, removeOnFail: 500 },
      )
      .catch((err) =>
        this.logger.warn(`Queue reconcile failed: ${(err as Error).message}`),
      );
  }

  async runActivateJob(auctionId: string): Promise<void> {
    const res = await this.auctionRepository
      .createQueryBuilder()
      .update(Auction)
      .set({ status: AuctionStatus.ACTIVE })
      .where('id = :id AND status = :s AND starts_at <= now()', {
        id: auctionId,
        s: AuctionStatus.SCHEDULED,
      })
      .execute();
    if (res.affected) {
      this.gateway.emitAuctionUpdate(auctionId, {
        type: 'auction.activated',
        auctionId,
      });
      this.logger.log(`Auction ${auctionId} activated`);
    }
  }

  /**
   * Close at `endsAt`. Claims the auction (ACTIVE/SCHEDULED → ENDED) with a
   * conditional update, so only one worker ever settles it.
   */
  async runCloseJob(auctionId: string): Promise<void> {
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!auction) return;
    if (auction.endsAt.getTime() > Date.now() + 5_000) {
      await this.scheduleAuctionJobs(auctionId, auction.endsAt);
      return;
    }
    if (
      auction.status !== AuctionStatus.ACTIVE &&
      auction.status !== AuctionStatus.SCHEDULED
    ) {
      return;
    }

    const winnerId = auction.currentLeaderUserId;
    const hammer =
      auction.currentBidUsd != null ? Number(auction.currentBidUsd) : null;
    const reserve =
      auction.reservePriceUsd != null ? Number(auction.reservePriceUsd) : null;
    const unsold =
      !winnerId || hammer === null || (reserve !== null && hammer < reserve);

    const claimed = await this.auctionRepository
      .createQueryBuilder()
      .update(Auction)
      .set({ status: unsold ? AuctionStatus.UNSOLD : AuctionStatus.ENDED })
      .where('id = :id AND status IN (:...s)', {
        id: auctionId,
        s: [AuctionStatus.ACTIVE, AuctionStatus.SCHEDULED],
      })
      .execute();
    if (!claimed.affected) return;

    if (unsold) {
      auction.status = AuctionStatus.UNSOLD;
      this.gateway.emitAuctionUpdate(auctionId, {
        type: 'auction.closed',
        auctionId,
        outcome: 'unsold',
      });
      void this.notifications.notifyLosers({ auction, winnerUserId: null });
      await this.enqueueReconcile(auctionId, 0);
      this.logger.log(`Auction ${auctionId} closed UNSOLD`);
      return;
    }

    auction.status = AuctionStatus.ENDED;
    await this.settleWinner(auction, winnerId, hammer);
  }

  private async leaderFunding(
    auctionId: string,
    userId: string,
  ): Promise<LeaderFunding> {
    const bid = await this.bidRepository.findOne({
      where: { auctionId, userId },
      order: { createdAt: 'DESC' },
    });
    return {
      fundingMethod: bid?.fundingMethod ?? 'card',
      stripePaymentMethodId: bid?.stripePaymentMethodId ?? null,
      cryptoWallet: bid?.cryptoWallet ?? null,
    };
  }

  private async addressFor(
    userId: string,
  ): Promise<ShippingAddressSnapshot | null> {
    const u = await this.userRepository.findOne({ where: { id: userId } });
    if (!u) return null;
    return {
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      addressLine1: u.address ?? '',
      addressLine2: u.address2 ?? '',
      city: u.city ?? '',
      state: u.state ?? '',
      zipCode: u.zipCode ?? '',
      country: u.country ?? 'United States',
    };
  }

  /** Charge / settle the (current) winner. `auction.status` is ENDED. */
  private async settleWinner(
    auction: Auction,
    winnerId: string,
    hammer: number,
  ): Promise<void> {
    const funding = await this.leaderFunding(auction.id, winnerId);
    const totals = winTotals(
      hammer,
      Number(auction.shippingUsd ?? 0),
      funding.fundingMethod,
    );
    auction.winnerUserId = winnerId;
    auction.winningAmountUsd = totals.hammerUsd.toFixed(2);
    auction.paymentMethod = funding.fundingMethod;
    auction.cardFeeUsd = totals.cardFeeUsd.toFixed(2);
    auction.totalChargedUsd = totals.totalUsd.toFixed(2);
    auction.shippingAddress = await this.addressFor(winnerId);
    auction.paymentIntentId = null;
    auction.paymentDueAt = null;
    await this.auctionRepository.save(auction);

    if (funding.fundingMethod === 'usdc') {
      try {
        const sig = await this.crypto.settle(
          auction.id,
          funding.cryptoWallet,
          round2(totals.hammerUsd + totals.shippingUsd),
        );
        await this.depositRepository.update(
          { auctionId: auction.id, userId: winnerId },
          {
            status: 'settled',
            settleSignature: sig,
            settledAmountUsd: round2(
              totals.hammerUsd + totals.shippingUsd,
            ).toFixed(2),
          },
        );
        await this.markPaid(auction, { reference: sig });
      } catch (err) {
        this.logger.error(
          `USDC settle failed for ${auction.id}: ${(err as Error).message}`,
        );
        await this.paymentFailed(auction, 'failed');
      }
      return;
    }

    if (!funding.stripePaymentMethodId) {
      await this.paymentFailed(auction, 'failed');
      return;
    }
    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.paymentsService.chargeWinner({
        userId: winnerId,
        paymentMethodId: funding.stripePaymentMethodId,
        kind: funding.fundingMethod as StripeMethodKind,
        amountUsd: totals.totalUsd,
        auctionId: auction.id,
        attempt: (auction.declinedUserIds?.length ?? 0) + 1,
        description: `Hermes Auctions — ${auction.title}`,
      });
    } catch (err) {
      this.logger.warn(
        `Charge raised for ${auction.id}: ${(err as Error).message}`,
      );
      await this.paymentFailed(auction, 'failed');
      return;
    }
    auction.paymentIntentId = intent.id;
    await this.applyIntent(auction, intent);
  }

  /** Branch on a PaymentIntent's state for the current winner. */
  private async applyIntent(
    auction: Auction,
    intent: Stripe.PaymentIntent,
  ): Promise<void> {
    auction.paymentIntentId = intent.id;
    if (intent.status === 'succeeded') {
      await this.markPaid(auction, { reference: intent.id });
    } else if (intent.status === 'processing') {
      // ACH: clears in days. The webhook / sweeper finishes it.
      auction.status = AuctionStatus.ENDED;
      await this.auctionRepository.save(auction);
      this.gateway.emitAuctionUpdate(auction.id, {
        type: 'auction.closed',
        auctionId: auction.id,
        outcome: 'pending_payment',
      });
      void this.notifications.notifyWinner({
        auction,
        winnerUserId: auction.winnerUserId,
        outcome: 'processing',
      });
      void this.notifications.notifyLosers({
        auction,
        winnerUserId: auction.winnerUserId,
      });
      await this.enqueueReconcile(auction.id, 0);
    } else if (
      intent.status === 'requires_action' ||
      intent.status === 'requires_confirmation'
    ) {
      await this.paymentFailed(auction, 'action_required');
    } else {
      await this.paymentFailed(auction, 'failed');
    }
  }

  private async paymentFailed(
    auction: Auction,
    outcome: 'action_required' | 'failed',
  ): Promise<void> {
    auction.status =
      outcome === 'failed' ? AuctionStatus.FAILED : AuctionStatus.ENDED;
    auction.paymentDueAt = new Date(
      Date.now() + PAYMENT_GRACE_HOURS * 60 * 60 * 1000,
    );
    await this.auctionRepository.save(auction);
    this.gateway.emitAuctionUpdate(auction.id, {
      type: 'auction.closed',
      auctionId: auction.id,
      outcome: 'pending_payment',
    });
    const jobId = `auction-autopay-retry__${auction.id}`;
    await this.auctionQueue.remove(jobId).catch(() => undefined);
    await this.auctionQueue.add(
      AUCTION_AUTOPAY_RETRY_JOB,
      { auctionId: auction.id },
      {
        jobId,
        delay: PAYMENT_GRACE_HOURS * 60 * 60 * 1000,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
    void this.notifications.notifyWinner({
      auction,
      winnerUserId: auction.winnerUserId,
      outcome,
    });
  }

  private async markPaid(
    auction: Auction,
    info: { reference: string },
  ): Promise<void> {
    auction.status = AuctionStatus.PAID;
    auction.paidAt = new Date();
    auction.paymentDueAt = null;
    if (info.reference.startsWith('pi_'))
      auction.paymentIntentId = info.reference;
    await this.auctionRepository.save(auction);
    await this.auctionQueue
      .remove(`auction-autopay-retry__${auction.id}`)
      .catch(() => undefined);
    this.gateway.emitAuctionUpdate(auction.id, {
      type: 'auction.closed',
      auctionId: auction.id,
      outcome: 'paid',
      winningBidUsd: Number(auction.winningAmountUsd),
    });
    await Promise.allSettled([
      this.notifications.notifyWinner({
        auction,
        winnerUserId: auction.winnerUserId,
        outcome: 'paid',
      }),
      this.notifications.notifyLosers({
        auction,
        winnerUserId: auction.winnerUserId,
      }),
      this.notifications.notifyAdminSold(auction),
    ]);
    await this.enqueueReconcile(auction.id, 0);
    this.logger.log(
      `Auction ${auction.id} PAID: ${auction.paymentMethod} $${auction.totalChargedUsd} ref=${info.reference}`,
    );
  }

  /** Re-checks an ENDED/FAILED auction's PaymentIntent (pull-based confirmation). */
  private async refreshPendingPayment(auction: Auction): Promise<void> {
    if (!auction.paymentIntentId || auction.paymentMethod === 'usdc') return;
    const pi = await this.paymentsService.retrievePaymentIntent(
      auction.paymentIntentId,
    );
    if (pi.status === 'succeeded') {
      await this.markPaid(auction, { reference: pi.id });
    } else if (
      auction.status === AuctionStatus.ENDED &&
      !auction.paymentDueAt &&
      (pi.status === 'requires_payment_method' || pi.status === 'canceled')
    ) {
      // ACH that later failed.
      await this.paymentFailed(auction, 'failed');
    }
  }

  /**
   * Grace window expired without payment: record the decline and offer the
   * item to the next-highest bidder who hasn't declined (no loops).
   */
  async runAutopayRetry(auctionId: string): Promise<void> {
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!auction) return;
    if (
      auction.status !== AuctionStatus.FAILED &&
      auction.status !== AuctionStatus.ENDED
    )
      return;
    if (auction.paymentIntentId && auction.paymentMethod !== 'usdc') {
      const pi = await this.paymentsService.retrievePaymentIntent(
        auction.paymentIntentId,
      );
      if (pi.status === 'succeeded')
        return this.markPaid(auction, { reference: pi.id });
      if (pi.status === 'processing') {
        await this.auctionQueue.add(
          AUCTION_AUTOPAY_RETRY_JOB,
          { auctionId },
          {
            jobId: `auction-autopay-retry__${auctionId}__${Date.now()}`,
            delay: 6 * 60 * 60 * 1000,
          },
        );
        return;
      }
    }

    const declined = [
      ...new Set(
        [...(auction.declinedUserIds ?? []), auction.winnerUserId].filter(
          Boolean,
        ),
      ),
    ];
    auction.declinedUserIds = declined;
    const qb = this.bidRepository
      .createQueryBuilder('b')
      .select('b.user_id', 'userId')
      .addSelect('MAX(b.amount_usd)', 'maxAmount')
      .where('b.auction_id = :id', { id: auctionId });
    if (declined.length)
      qb.andWhere('b.user_id NOT IN (:...declined)', { declined });
    const [next] = await qb
      .groupBy('b.user_id')
      .orderBy('MAX(b.amount_usd)', 'DESC')
      .limit(1)
      .getRawMany<{ userId: string; maxAmount: string }>();

    const reserve =
      auction.reservePriceUsd != null ? Number(auction.reservePriceUsd) : null;
    const nextAmount = next ? Number(next.maxAmount) : 0;
    const nextFunding = next
      ? await this.leaderFunding(auctionId, next.userId)
      : null;
    // A USDC runner-up's escrow was already returned when they were outbid.
    const usable =
      next &&
      (reserve === null || nextAmount >= reserve) &&
      nextFunding.fundingMethod !== 'usdc';

    if (!usable) {
      auction.status = AuctionStatus.UNSOLD;
      auction.winnerUserId = null;
      await this.auctionRepository.save(auction);
      this.gateway.emitAuctionUpdate(auctionId, {
        type: 'auction.closed',
        auctionId,
        outcome: 'unsold',
      });
      await this.enqueueReconcile(auctionId, 0);
      this.logger.log(`Auction ${auctionId}: no eligible runner-up, UNSOLD`);
      return;
    }

    this.logger.log(
      `Auction ${auctionId}: offering to runner-up ${next.userId} at $${nextAmount}`,
    );
    auction.currentLeaderUserId = next.userId;
    auction.currentBidUsd = nextAmount.toFixed(2);
    auction.status = AuctionStatus.ENDED;
    await this.settleWinner(auction, next.userId, nextAmount);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Winner payment (retry / confirm / webhook)
  // ─────────────────────────────────────────────────────────────────────

  async getPaymentInfo(userId: string, auctionId: string) {
    const a = await this.getOrThrow(auctionId);
    if (a.winnerUserId !== userId) {
      throw new ForbiddenException(
        'Only the winning bidder can view this payment.',
      );
    }
    const hammer = Number(a.winningAmountUsd ?? 0);
    const shipping = Number(a.shippingUsd ?? 0);
    let intentStatus: string | null = null;
    if (a.paymentIntentId && a.status !== AuctionStatus.PAID) {
      intentStatus = (
        await this.paymentsService.retrievePaymentIntent(a.paymentIntentId)
      ).status;
    }
    const canPay =
      a.status === AuctionStatus.FAILED ||
      (a.status === AuctionStatus.ENDED &&
        intentStatus !== 'processing' &&
        !!a.paymentDueAt);
    return {
      auctionId: a.id,
      title: a.title,
      image: a.images?.[0]?.url ?? null,
      status: a.status,
      paymentMethod: a.paymentMethod,
      intentStatus,
      hammerUsd: hammer,
      shippingUsd: shipping,
      cardFeeUsd: Number(a.cardFeeUsd ?? 0),
      totalUsd: Number(a.totalChargedUsd ?? 0),
      paymentDueAt: a.paymentDueAt?.toISOString() ?? null,
      paidAt: a.paidAt?.toISOString() ?? null,
      canPay,
      options: {
        card: winTotals(hammer, shipping, 'card'),
        ach: winTotals(hammer, shipping, 'ach'),
      },
      fulfillment: {
        status: a.fulfillmentStatus,
        carrier: a.carrier,
        trackingNumber: a.trackingNumber,
        shippedAt: a.shippedAt?.toISOString() ?? null,
      },
      shippingAddress: a.shippingAddress,
    };
  }

  async createRetryCheckout(params: {
    userId: string;
    auctionId: string;
    method: 'card' | 'ach';
    returnUrl: string;
  }): Promise<{ url: string }> {
    const info = await this.getPaymentInfo(params.userId, params.auctionId);
    if (!info.canPay) {
      throw new BadRequestException('This auction is not awaiting payment.');
    }
    // Hold the item for the winner while they're in checkout.
    await this.auctionQueue
      .remove(`auction-autopay-retry__${params.auctionId}`)
      .catch(() => undefined);
    return this.paymentsService.createRetryPaymentCheckoutSession({
      userId: params.userId,
      auctionId: params.auctionId,
      amountUsd: info.options[params.method].totalUsd,
      itemName: info.title ?? 'Hermes Auctions win',
      returnUrl: params.returnUrl,
      kind: params.method,
    });
  }

  /** Called on return from Stripe Checkout and from the webhook. */
  async confirmCheckoutSession(
    sessionId: string,
    expectedUserId?: string,
  ): Promise<void> {
    const session =
      await this.paymentsService.retrieveCheckoutSession(sessionId);
    if (session.metadata?.type !== 'hermes_auction_payment') return;
    const auctionId = session.metadata.auctionId;
    const userId = session.metadata.userId;
    if (expectedUserId && userId !== expectedUserId) {
      throw new ForbiddenException('That payment belongs to another account.');
    }
    const a = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!a || a.winnerUserId !== userId || a.status === AuctionStatus.PAID)
      return;

    const kind: StripeMethodKind =
      session.payment_method_types?.[0] === 'us_bank_account' ? 'ach' : 'card';
    const totals = winTotals(
      Number(a.winningAmountUsd),
      Number(a.shippingUsd ?? 0),
      kind,
    );
    a.paymentMethod = kind;
    a.cardFeeUsd = totals.cardFeeUsd.toFixed(2);
    a.totalChargedUsd = totals.totalUsd.toFixed(2);
    const piId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (piId) a.paymentIntentId = piId;

    if (session.payment_status === 'paid') {
      await this.markPaid(a, { reference: piId ?? session.id });
    } else if (session.status === 'complete' && piId) {
      a.status = AuctionStatus.ENDED;
      a.paymentDueAt = null;
      await this.auctionRepository.save(a);
    }
  }

  async handleStripeEvent(event: Stripe.Event): Promise<void> {
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object;
      if (session.metadata?.type === 'hermes_auction_payment') {
        await this.confirmCheckoutSession(session.id);
      }
      return;
    }
    if (
      event.type === 'payment_intent.succeeded' ||
      event.type === 'payment_intent.payment_failed'
    ) {
      const pi = event.data.object;
      if (!pi.metadata?.source?.startsWith('hermes.') || !pi.metadata.auctionId)
        return;
      const a = await this.auctionRepository.findOne({
        where: { id: pi.metadata.auctionId },
      });
      if (
        !a ||
        a.winnerUserId !== pi.metadata.userId ||
        a.status === AuctionStatus.PAID
      )
        return;
      if (event.type === 'payment_intent.succeeded') {
        await this.markPaid(a, { reference: pi.id });
      } else if (
        a.status === AuctionStatus.ENDED &&
        a.paymentIntentId === pi.id &&
        !a.paymentDueAt
      ) {
        await this.paymentFailed(a, 'failed');
      }
    }
  }

  /** Legacy hook kept for PaymentsService; routes to the Hermes confirm path. */
  async handleRetryCheckoutCompleted(params: {
    auctionId: string;
    userId: string;
    paymentIntentId: string;
  }): Promise<void> {
    const a = await this.auctionRepository.findOne({
      where: { id: params.auctionId },
    });
    if (
      !a ||
      a.winnerUserId !== params.userId ||
      a.status === AuctionStatus.PAID
    )
      return;
    await this.markPaid(a, { reference: params.paymentIntentId });
  }

  // ─────────────────────────────────────────────────────────────────────
  // My auctions
  // ─────────────────────────────────────────────────────────────────────

  async listMine(userId: string) {
    const ids = await this.getRecentBidAuctions(userId);
    if (ids.length === 0) return [];
    const rows = await this.auctionRepository.find({
      where: { id: In(ids.map((r) => r.auctionId)) },
    });
    const order = new Map(ids.map((r, i) => [r.auctionId, i]));
    rows.sort((a, b) => order.get(a.id) - order.get(b.id));
    const dtos = await this.toPublicMany(
      rows.filter((r) => !!r.title),
      userId,
    );
    return dtos.map((d) => {
      let state: 'leading' | 'outbid' | 'won' | 'lost' | 'pay';
      if (d.bucket !== 'settled')
        state = d.viewer?.isLeader ? 'leading' : 'outbid';
      else if (d.viewer?.isWinner) {
        state = d.status === AuctionStatus.PAID ? 'won' : 'pay';
      } else state = 'lost';
      return { ...d, state };
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // USDC escrow
  // ─────────────────────────────────────────────────────────────────────

  async quoteDeposit(
    userId: string,
    auctionId: string,
    dto: CryptoDepositQuoteDto,
  ) {
    if (!this.crypto.isEnabled()) {
      throw new BadRequestException('USDC bidding is not available right now.');
    }
    const a = await this.getOrThrow(auctionId);
    if (!methodsFor(a.acceptedPayments ?? 'both').includes('usdc')) {
      throw new BadRequestException(
        'This auction only accepts card or bank (ACH) payments.',
      );
    }
    if (
      a.status !== AuctionStatus.ACTIVE &&
      a.status !== AuctionStatus.SCHEDULED
    ) {
      throw new BadRequestException('This auction is closed.');
    }
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (user?.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'House accounts cannot bid on Hermes auctions.',
      );
    }
    const taken = await this.depositRepository.findOne({
      where: { auctionId, wallet: dto.wallet },
    });
    if (taken && taken.userId !== userId) {
      throw new BadRequestException(
        'That wallet is already bidding on this auction from another account.',
      );
    }
    const mine = await this.depositRepository.findOne({
      where: { auctionId, userId },
    });
    if (mine && mine.status === 'held' && mine.wallet !== dto.wallet) {
      throw new BadRequestException(
        `You already have USDC escrowed from ${mine.wallet.slice(0, 4)}…${mine.wallet.slice(-4)}. Top up from that wallet.`,
      );
    }

    if (!a.onchainAuction) {
      a.onchainAuction = await this.crypto.ensureAuctionOpened(a.id, a.endsAt);
      await this.auctionRepository.update(
        { id: a.id },
        { onchainAuction: a.onchainAuction },
      );
    }
    return {
      ...(await this.crypto.buildDepositTx({
        auctionId,
        userId,
        wallet: dto.wallet,
        amountUsd: dto.amountUsd,
      })),
      currentEscrowUsd: mine?.status === 'held' ? Number(mine.amountUsd) : 0,
    };
  }

  async confirmDeposit(
    userId: string,
    auctionId: string,
    dto: CryptoDepositConfirmDto,
  ) {
    const { balanceUsd, escrow } = await this.crypto.verifyDeposit({
      auctionId,
      userId,
      wallet: dto.wallet,
      signature: dto.signature,
    });
    let row = await this.depositRepository.findOne({
      where: { auctionId, userId },
    });
    if (!row) {
      row = this.depositRepository.create({
        auctionId,
        userId,
        wallet: dto.wallet,
        escrowAddress: escrow,
        depositSignatures: [],
      });
    }
    row.wallet = dto.wallet;
    row.escrowAddress = escrow;
    row.status = 'held';
    row.amountUsd = balanceUsd.toFixed(2);
    row.refundSignature = null;
    if (!row.depositSignatures.includes(dto.signature)) {
      row.depositSignatures = [...row.depositSignatures, dto.signature];
    }
    await this.depositRepository.save(row);
    return { escrowUsd: balanceUsd, escrow };
  }

  /**
   * Refunds every held escrow that no longer backs the lead (or the
   * settled win). A deposit made in the last few minutes that hasn't been
   * bid with yet is left alone so the bidder can use it.
   */
  async reconcileCrypto(auctionId: string): Promise<void> {
    if (!this.crypto.isEnabled()) return;
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!auction) return;
    const held = await this.depositRepository.find({
      where: { auctionId, status: 'held' },
    });
    if (held.length === 0) return;
    const open =
      auction.status === AuctionStatus.ACTIVE ||
      auction.status === AuctionStatus.SCHEDULED;

    for (const d of held) {
      let keep = false;
      if (open) {
        if (d.userId === auction.currentLeaderUserId) {
          keep =
            (await this.leaderFunding(auctionId, d.userId)).fundingMethod ===
            'usdc';
        }
        if (
          !keep &&
          Date.now() - d.updatedAt.getTime() < UNUSED_DEPOSIT_GRACE_MS
        ) {
          const lastBid = await this.bidRepository.findOne({
            where: { auctionId, userId: d.userId, isProxyAuto: false },
            order: { createdAt: 'DESC' },
          });
          keep = !lastBid || lastBid.createdAt < d.updatedAt;
        }
      } else if (
        auction.status === AuctionStatus.ENDED &&
        auction.winnerUserId === d.userId &&
        auction.paymentMethod === 'usdc'
      ) {
        keep = true; // settle in flight
      }
      if (keep) continue;

      try {
        const sig = await this.crypto.refund(auctionId, d.wallet);
        d.status = 'refunded';
        d.refundSignature = sig;
        d.amountUsd = '0.00';
        await this.depositRepository.save(d);
        this.logger.log(
          `Refunded USDC escrow ${d.escrowAddress} for auction ${auctionId} tx=${sig ?? 'already-closed'}`,
        );
      } catch (err) {
        this.logger.warn(
          `Refund of ${d.escrowAddress} failed: ${(err as Error).message}`,
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Legacy compatibility (PrizeService)
  // ─────────────────────────────────────────────────────────────────────

  buildSummary(
    auction: Auction,
    opts: {
      userId?: string;
      isBidder?: boolean;
      shippingCostUsd?: number | null;
    } = {},
  ): AuctionSummaryDto {
    const current =
      auction.currentBidUsd != null ? Number(auction.currentBidUsd) : null;
    const start = Number(auction.startingPriceUsd);
    const reserve =
      auction.reservePriceUsd != null ? Number(auction.reservePriceUsd) : null;
    const shipping = opts.shippingCostUsd ?? Number(auction.shippingUsd ?? 0);
    const next = minNextBid(current, start);
    const nowTotals =
      current === null ? null : winTotals(current, shipping, 'card');
    const nextTotals = winTotals(next, shipping, 'card');
    return {
      id: auction.id,
      status: auction.status,
      startsAt: auction.startsAt.toISOString(),
      endsAt: auction.endsAt.toISOString(),
      durationDays: auction.durationDays ?? 0,
      startingPriceUsd: start,
      currentBidUsd: current,
      minNextBidIncrement: minIncrementFor(current ?? start),
      minNextBidUsd: next,
      bidCount: auction.bidCount,
      extensionCount: auction.extensionCount,
      reserveMet:
        reserve === null ? null : current !== null && current >= reserve,
      isLeader: !!opts.userId && auction.currentLeaderUserId === opts.userId,
      isBidder: !!opts.isBidder,
      buyerProcessingFeePercent: CARD_PROCESSING_PERCENT,
      buyerProcessingFeeUsd: nowTotals?.cardFeeUsd ?? null,
      totalDueIfWonUsd: nowTotals?.totalUsd ?? null,
      minNextBidProcessingFeeUsd: nextTotals.cardFeeUsd,
      minNextBidTotalUsd: nextTotals.totalUsd,
      currentUserProxyMaxUsd:
        !!opts.userId &&
        auction.currentLeaderUserId === opts.userId &&
        auction.proxyMaxUsd
          ? Number(auction.proxyMaxUsd)
          : null,
      shippingCostUsd: shipping,
    };
  }

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

  async getRecentBidAuctions(
    userId: string,
  ): Promise<{ auctionId: string; lastBidAt: Date }[]> {
    if (!userId) return [];
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
}
