import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Auction } from '../prize/entities/auction.entity';
import { AuctionBid } from '../prize/entities/auction-bid.entity';
import { PrizeConfiguration } from '../prize/entities/prize-configuration.entity';
import { PrizeItemWatcher } from '../prize/entities/prize-item-watcher.entity';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import { User } from '../users/entities/user.entity';
import { EmailType } from '../enums/email-type.enum';
import { QueueService } from '../queue/queue.service';
import { InboxService } from '../inbox/inbox.service';
import { EmailsService } from '../emails/email.service';

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
    @InjectRepository(PrizeOrder)
    private readonly prizeOrderRepository: Repository<PrizeOrder>,
    private readonly queueService: QueueService,
    private readonly inboxService: InboxService,
    private readonly configService: ConfigService,
    private readonly emailsService: EmailsService,
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

  /**
   * Format a date for inclusion in reminder/notification emails.
   *
   * We don't store a per-user timezone, so rather than emitting an
   * ambiguous server-local string (which renders as UTC in production
   * with no zone label), we render the same instant in ET plus UTC,
   * e.g.:
   *
   *   "May 12, 2026, 6:45 PM ET (22:45 UTC)"
   *
   * That keeps the primary line short and US-readable while making the
   * exact instant unambiguous for any recipient regardless of locale.
   */
  private fmtDate(d: Date): string {
    const inZone = (timeZone: string, opts: Intl.DateTimeFormatOptions) =>
      d.toLocaleString('en-US', { ...opts, timeZone });

    const eastern = inZone('America/New_York', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const utc = inZone('UTC', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    return `${eastern} ET (${utc} UTC)`;
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

    // Failed / pending payment: branch off into the dedicated
    // "update payment" email + inbox flow. This way the user gets a
    // single, action-oriented notification (with a deep-link to the
    // retry page) instead of the generic "you won" email which would
    // be confusing when no charge actually went through. We still
    // suppress the inbox's auto-email so the user only gets one email.
    if (
      params.chargeStatus === 'failed' ||
      params.chargeStatus === 'pending_action'
    ) {
      const retryUrl = `${this.appHost().replace(/\/$/, '')}/auctions/${
        auction.id
      }/retry-payment`;
      const failureReason =
        params.chargeStatus === 'pending_action'
          ? 'Your card requires additional authentication (3DS).'
          : '';

      await Promise.allSettled([
        this.inboxService
          .sendSystemMessageToUser(
            params.winnerUserId,
            `You won ${itemName} for ${winningBid} but we couldn't charge your card (total ${totalCharged}). Your win is held for 24 hours — [update payment & complete purchase](${retryUrl}) before the next bidder is offered the item.`,
            { suppressEmail: true },
          )
          .catch((err) =>
            this.logger.warn(`Winner-failed inbox failed: ${err?.message}`),
          ),
        user.email
          ? this.queueService
              .addEmailJob(
                {
                  toAddress: [user.email],
                  subject: `Action needed: payment failed for ${itemName}`,
                  params: {
                    userName: user.username || 'there',
                    itemName,
                    winningBid,
                    buyerFee,
                    shippingFee,
                    totalCharged,
                    failureReason,
                    retryUrl,
                  },
                } as never,
                EmailType.AuctionPaymentFailed,
              )
              .catch((err) =>
                this.logger.warn(`Winner-failed email failed: ${err?.message}`),
              )
          : Promise.resolve(),
      ]);
      return;
    }

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

  /**
   * Notify the seller (or CardCade admin for house items) that their
   * auction item has sold + paid. Mirrors `seller_shop_purchase` from
   * the shop flow so we can re-use the existing template (which already
   * renders buyer name, shipping address block and a "Mark as Shipped &
   * Add Tracking" CTA pointing at the seller dashboard / admin
   * redemptions page).
   *
   * Best-effort: failures are logged, never thrown.
   */
  async notifySellerOfSale(params: {
    auctionId: string;
    orderId: string;
  }): Promise<void> {
    try {
      const auction = await this.auctionRepository.findOne({
        where: { id: params.auctionId },
      });
      if (!auction) return;
      const prize = await this.prizeRepository.findOne({
        where: { id: auction.prizeConfigurationId },
      });
      if (!prize) return;
      const order = await this.prizeOrderRepository.findOne({
        where: { id: params.orderId },
        relations: ['user'],
      });
      if (!order) return;
      const buyer = order.user;

      const frontendUrl =
        this.configService.get<string>('CLIENT_URL') ||
        this.appHost() ||
        'http://localhost:3000';

      // Route to admin (CardCade-owned items) vs seller dashboard.
      let recipientEmail: string | null = null;
      let recipientName = 'Seller';
      // In-person items don't ship — omit the Mark-as-Shipped CTA. The EJS
      // template's `<% if (params.markShippedUrl) %>` guard hides the button.
      let markShippedUrl: string | undefined;
      const isInPerson = prize.isInPerson === true;

      if (!prize.createdBy) {
        recipientEmail =
          this.configService.get<string>('ADMIN_EMAIL') ||
          'contact@cardcade.fun';
        recipientName = 'CardCade Admin';
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl.replace(/\/$/, '')}/admin/prizes/redemptions?orderId=${order.id}`;
      } else {
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });
        if (!seller || !seller.email) {
          this.logger.warn(
            `Seller ${prize.createdBy} not found / no email for auction ${auction.id}`,
          );
          return;
        }
        recipientEmail = seller.email;
        recipientName =
          seller.shopName || seller.name || seller.username || 'Seller';
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl.replace(/\/$/, '')}/seller/shop/manage?tab=orders&orderId=${order.id}`;
      }

      // Show seller the amount net of buyer fee (matches shop email).
      const charged = parseFloat(order.usdCharged?.toString() || '0');
      const sellerVisibleAmount =
        charged > 0
          ? parseFloat((charged / 1.05).toFixed(2)) // ~5% buyer fee
          : Number(order.totalPrice ?? 0);

      const shipping: PrizeOrder['shippingAddress'] =
        order.shippingAddress || {
          firstName: '',
          lastName: '',
          addressLine1: '',
          city: '',
          state: '',
          zipCode: '',
          country: '',
        };
      const buyerFullName =
        [shipping.firstName, shipping.lastName].filter(Boolean).join(' ') ||
        buyer?.name ||
        buyer?.username ||
        'Buyer';

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [recipientEmail],
          subject: `New Sale! ${prize.name} won at auction 🎉`,
          params: {
            sellerName: recipientName,
            itemName: prize.name,
            buyerName: buyer?.name || buyer?.username || 'Buyer',
            amount: sellerVisibleAmount,
            orderId: order.id,
            purchaseDate: new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
            buyerFullName,
            shippingAddressLine1: isInPerson ? '' : shipping.addressLine1 || '',
            shippingAddressLine2: isInPerson ? '' : shipping.addressLine2 || '',
            shippingCity: isInPerson ? '' : shipping.city || '',
            shippingState: isInPerson ? '' : shipping.state || '',
            shippingZipCode: isInPerson ? '' : shipping.zipCode || '',
            shippingCountry: isInPerson ? '' : shipping.country || '',
            markShippedUrl,
          },
        },
        'seller_shop_purchase',
      );

      this.logger.log(
        `Auction-sale notification sent to ${recipientEmail} for order ${order.id}`,
      );
    } catch (err) {
      this.logger.error(
        `notifySellerOfSale failed for auction ${params.auctionId}: ${
          (err as Error)?.message
        }`,
      );
    }
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
