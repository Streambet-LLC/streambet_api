import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Auction } from '../prize/entities/auction.entity';
import { AuctionBid } from '../prize/entities/auction-bid.entity';
import { PrizeConfiguration } from '../prize/entities/prize-configuration.entity';
import { PrizeItemWatcher } from '../prize/entities/prize-item-watcher.entity';
import { User } from '../users/entities/user.entity';
import { EmailType } from '../enums/email-type.enum';
import { QueueService } from '../queue/queue.service';
import { InboxService } from '../inbox/inbox.service';

/**
 * Centralized auction notification dispatch.
 *
 * Channels:
 *  - Inbox (CardCade system bot, markdown link supported)
 *  - Email (queued via QueueService → EmailProcessor → SES/MailHog)
 *
 * Both channels are best-effort and isolated via Promise.allSettled so a
 * single recipient's failure never poisons the rest of the batch.
 *
 * Outbid notifications fire on every outbid event (no debounce) so bidders
 * can react in real time to fast proxy-bid wars.
 */
@Injectable()
export class AuctionsNotificationsService {
  private readonly logger = new Logger(AuctionsNotificationsService.name);

  constructor(
    @InjectRepository(Auction)
    private readonly auctionRepository: Repository<Auction>,
    @InjectRepository(AuctionBid)
    private readonly bidRepository: Repository<AuctionBid>,
    @InjectRepository(PrizeConfiguration)
    private readonly prizeRepository: Repository<PrizeConfiguration>,
    @InjectRepository(PrizeItemWatcher)
    private readonly watcherRepository: Repository<PrizeItemWatcher>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly queueService: QueueService,
    private readonly inboxService: InboxService,
    private readonly configService: ConfigService,
  ) {}

  /** Public site host used in inbox/email links. */
  private appHost(): string {
    return (
      this.configService.get<string>('email.HOST_URL') ||
      this.configService.get<string>('APP_HOST_URL') ||
      ''
    );
  }

  private auctionUrl(auctionId: string, prizeId: string): string {
    const host = this.appHost().replace(/\/$/, '');
    return `${host}/shop/item/${prizeId}?auction=${auctionId}`;
  }

  private orderUrl(orderId: string): string {
    const host = this.appHost().replace(/\/$/, '');
    return `${host}/account/orders/${orderId}`;
  }

  private fmtUsd(n: number): string {
    return `$${n.toFixed(2)}`;
  }

  private fmtDate(d: Date): string {
    return d.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Outbid (debounced)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Notify the previous leader they were outbid. Sent on EVERY outbid
   * event (no debounce) so bidders can react in real time during fast
   * proxy-bid wars. The matching inbox message + email both fire on each
   * call.
   */
  async notifyOutbid(params: {
    previousLeaderUserId: string;
    auctionId: string;
  }): Promise<void> {
    const { previousLeaderUserId, auctionId } = params;

    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!auction) return;
    const prize = await this.prizeRepository.findOne({
      where: { id: auction.prizeConfigurationId },
    });
    const user = await this.userRepository.findOne({
      where: { id: previousLeaderUserId },
    });
    if (!user || !prize) return;

    const itemName = prize.name || 'an auction item';
    const url = this.auctionUrl(auction.id, prize.id);
    const currentBid = auction.currentBidUsd
      ? this.fmtUsd(Number(auction.currentBidUsd))
      : this.fmtUsd(Number(auction.startingPriceUsd));
    const minNext = this.fmtUsd(
      this.computeMinNext(
        auction.currentBidUsd ? Number(auction.currentBidUsd) : null,
        Number(auction.startingPriceUsd),
      ),
    );
    const endsAt = this.fmtDate(auction.endsAt);

    await Promise.allSettled([
      this.inboxService
        .sendSystemMessageToUser(
          previousLeaderUserId,
          `You've been outbid on ${itemName}. Current bid is ${currentBid}, min next bid ${minNext}. [Place a higher bid](${url})`,
          { suppressEmail: true },
        )
        .catch((err) =>
          this.logger.warn(`Outbid inbox failed: ${err?.message}`),
        ),
      user.email
        ? this.queueService
            .addEmailJob(
              {
                toAddress: [user.email],
                subject: `You've been outbid on ${itemName}`,
                params: {
                  userName: user.username || 'there',
                  itemName,
                  currentBid,
                  minNextBid: minNext,
                  endsAt,
                  auctionUrl: url,
                },
              } as never,
              EmailType.AuctionOutbid,
            )
            .catch((err) =>
              this.logger.warn(`Outbid email failed: ${err?.message}`),
            )
        : Promise.resolve(),
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Closing soon (1h before endsAt)
  // ─────────────────────────────────────────────────────────────────────

  async notifyClosingSoon(auctionId: string): Promise<void> {
    const auction = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!auction) return;
    if (auction.endsAt.getTime() - Date.now() < 0) return; // already over

    const prize = await this.prizeRepository.findOne({
      where: { id: auction.prizeConfigurationId },
    });
    if (!prize) return;

    // Distinct bidders + watchers (deduplicated)
    const bidderRows = await this.bidRepository
      .createQueryBuilder('b')
      .select('DISTINCT b.user_id', 'userId')
      .where('b.auction_id = :id', { id: auctionId })
      .getRawMany<{ userId: string }>();
    const watcherRows = await this.watcherRepository.find({
      where: { itemId: prize.id },
      select: { userId: true },
    });
    const userIdSet = new Set<string>([
      ...bidderRows.map((r) => r.userId),
      ...watcherRows.map((w) => w.userId),
    ]);
    if (userIdSet.size === 0) return;

    const users = await this.userRepository.find({
      where: { id: In(Array.from(userIdSet)) },
    });
    const itemName = prize.name || 'an auction item';
    const url = this.auctionUrl(auction.id, prize.id);
    const currentBid = auction.currentBidUsd
      ? this.fmtUsd(Number(auction.currentBidUsd))
      : this.fmtUsd(Number(auction.startingPriceUsd));
    const endsAt = this.fmtDate(auction.endsAt);

    await Promise.allSettled(
      users.flatMap((u) => [
        this.inboxService
          .sendSystemMessageToUser(
            u.id,
            `${itemName} closes in ~1 hour. Current bid ${currentBid}. Bids in the final 30s extend the auction. [View the auction](${url})`,
            { suppressEmail: true },
          )
          .catch((err) =>
            this.logger.warn(`Closing-soon inbox failed: ${err?.message}`),
          ),
        u.email
          ? this.queueService
              .addEmailJob(
                {
                  toAddress: [u.email],
                  subject: `Closing soon: ${itemName}`,
                  params: {
                    userName: u.username || 'there',
                    itemName,
                    currentBid,
                    endsAt,
                    auctionUrl: url,
                  },
                } as never,
                EmailType.AuctionClosingSoon,
              )
              .catch((err) =>
                this.logger.warn(`Closing-soon email failed: ${err?.message}`),
              )
          : Promise.resolve(),
      ]),
    );
    this.logger.log(
      `Closing-soon dispatched for auction ${auctionId} to ${users.length} recipients`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Won / Lost (after close)
  // ─────────────────────────────────────────────────────────────────────

  async notifyWinner(params: {
    winnerUserId: string;
    auctionId: string;
    winningBidUsd: number;
    buyerFeeUsd: number;
    shippingUsd?: number;
    totalChargedUsd: number;
    chargeStatus: 'charged' | 'pending_action' | 'failed';
    orderId: string | null;
  }): Promise<void> {
    const auction = await this.auctionRepository.findOne({
      where: { id: params.auctionId },
    });
    if (!auction) return;
    const prize = await this.prizeRepository.findOne({
      where: { id: auction.prizeConfigurationId },
    });
    const user = await this.userRepository.findOne({
      where: { id: params.winnerUserId },
    });
    if (!user || !prize) return;

    // Resolve the seller (if any). Prizes with a non-null createdBy that
    // resolves to a seller account are seller-owned; otherwise the item
    // is sold directly by CardCade. We use this to (a) show the seller's
    // shop name in the email and (b) swap the shipping confirmation copy
    // since CardCade ships its own inventory but seller items are
    // shipped directly by the seller.
    let seller: User | null = null;
    if (prize.createdBy) {
      seller = await this.userRepository.findOne({
        where: { id: prize.createdBy },
      });
    }
    const isSellerOwned = !!seller && seller.isSeller === true;
    const sellerName =
      isSellerOwned && seller
        ? seller.shopName || seller.username || 'the seller'
        : 'CardCade';

    const itemName = prize.name || 'an auction item';
    const orderUrl = params.orderId
      ? this.orderUrl(params.orderId)
      : `${this.appHost().replace(/\/$/, '')}/account/orders`;
    const winningBid = this.fmtUsd(params.winningBidUsd);
    const buyerFee = this.fmtUsd(params.buyerFeeUsd);
    // Fall back to the prize's stored shipping if the caller didn't
    // pass one (kept optional so existing call sites don't break during
    // partial rollouts).
    const shippingUsdValue =
      params.shippingUsd != null
        ? params.shippingUsd
        : prize.shippingCostUsd != null
          ? Number(prize.shippingCostUsd)
          : 0;
    const shippingFee = this.fmtUsd(shippingUsdValue);
    const totalCharged = this.fmtUsd(params.totalChargedUsd);
    const chargeStatus =
      params.chargeStatus === 'charged'
        ? 'Charged successfully'
        : params.chargeStatus === 'pending_action'
          ? 'Awaiting card authentication (3DS)'
          : 'Charge failed — please update your card';

    await Promise.allSettled([
      this.inboxService
        .sendSystemMessageToUser(
          params.winnerUserId,
          `You won ${itemName} for ${winningBid}. Total charged: ${totalCharged} (incl. ${buyerFee} buyer fee + ${shippingFee} shipping). [View your order](${orderUrl})`,
          { suppressEmail: true },
        )
        .catch((err) =>
          this.logger.warn(`Winner inbox failed: ${err?.message}`),
        ),
      user.email
        ? this.queueService
            .addEmailJob(
              {
                toAddress: [user.email],
                subject: `You won the auction: ${itemName}`,
                params: {
                  userName: user.username || 'there',
                  itemName,
                  winningBid,
                  buyerFee,
                  shippingFee,
                  totalCharged,
                  chargeStatus,
                  sellerName,
                  isSellerOwned,
                  orderUrl,
                },
              } as never,
              EmailType.AuctionWon,
            )
            .catch((err) =>
              this.logger.warn(`Winner email failed: ${err?.message}`),
            )
        : Promise.resolve(),
    ]);
  }

  async notifyLosers(params: {
    auctionId: string;
    winnerUserId: string | null;
    winningBidUsd: number;
  }): Promise<void> {
    const auction = await this.auctionRepository.findOne({
      where: { id: params.auctionId },
    });
    if (!auction) return;
    const prize = await this.prizeRepository.findOne({
      where: { id: auction.prizeConfigurationId },
    });
    if (!prize) return;

    const bidderRows = await this.bidRepository
      .createQueryBuilder('b')
      .select('DISTINCT b.user_id', 'userId')
      .where('b.auction_id = :id', { id: params.auctionId })
      .getRawMany<{ userId: string }>();
    const loserIds = bidderRows
      .map((r) => r.userId)
      .filter((id) => id !== params.winnerUserId);
    if (loserIds.length === 0) return;

    const users = await this.userRepository.find({
      where: { id: In(loserIds) },
    });
    const itemName = prize.name || 'an auction item';
    const winningBid = this.fmtUsd(params.winningBidUsd);
    const shopUrl = `${this.appHost().replace(/\/$/, '')}/shop`;

    await Promise.allSettled(
      users.flatMap((u) => [
        this.inboxService
          .sendSystemMessageToUser(
            u.id,
            `The auction for ${itemName} has ended. Winning bid was ${winningBid}. No charge was made to your card. [Browse the shop](${shopUrl})`,
            { suppressEmail: true },
          )
          .catch((err) =>
            this.logger.warn(`Loser inbox failed: ${err?.message}`),
          ),
        u.email
          ? this.queueService
              .addEmailJob(
                {
                  toAddress: [u.email],
                  subject: `Auction ended: ${itemName}`,
                  params: {
                    userName: u.username || 'there',
                    itemName,
                    winningBid,
                    shopUrl,
                  },
                } as never,
                EmailType.AuctionLost,
              )
              .catch((err) =>
                this.logger.warn(`Loser email failed: ${err?.message}`),
              )
          : Promise.resolve(),
      ]),
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────

  private computeMinNext(currentUsd: number | null, startUsd: number): number {
    if (currentUsd === null) return startUsd;
    const inc = currentUsd < 50 ? 1 : currentUsd < 250 ? 3 : 5;
    return +(currentUsd + inc).toFixed(2);
  }
}
