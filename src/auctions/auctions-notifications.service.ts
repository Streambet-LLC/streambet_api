import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Auction } from '../prize/entities/auction.entity';
import { AuctionBid } from '../prize/entities/auction-bid.entity';
import { User } from '../users/entities/user.entity';
import { EmailType } from '../enums/email-type.enum';
import { QueueService } from '../queue/queue.service';
import { minNextBid } from './hermes.pricing';

interface NoticeRow {
  label: string;
  value: string;
}

interface Notice {
  subject: string;
  heading: string;
  intro: string;
  itemName?: string;
  rows?: NoticeRow[];
  ctaLabel?: string;
  ctaUrl?: string;
  footnote?: string;
}

const METHOD_LABEL: Record<string, string> = {
  card: 'Card',
  ach: 'Bank (ACH)',
  usdc: 'USDC',
};

/**
 * Hermes Auctions email notifications (one branded template, varied copy).
 * Best-effort: every send is isolated so one bad address never blocks the
 * rest of a batch, and failures are logged rather than thrown.
 */
@Injectable()
export class AuctionsNotificationsService {
  private readonly logger = new Logger(AuctionsNotificationsService.name);

  constructor(
    @InjectRepository(Auction)
    private readonly auctionRepository: Repository<Auction>,
    @InjectRepository(AuctionBid)
    private readonly bidRepository: Repository<AuctionBid>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {}

  private site(): string {
    return (
      this.configService.get<string>('CLIENT_URL') ||
      this.configService.get<string>('APP_HOST_URL') ||
      ''
    ).replace(/\/$/, '');
  }

  private auctionUrl(id: string): string {
    return `${this.site()}/auctions/${id}`;
  }

  private payUrl(id: string): string {
    return `${this.site()}/auctions/${id}/pay`;
  }

  private logoUrl(): string {
    return `${this.site()}/hermes/hermes-auctions-logo.png`;
  }

  private fmtUsd(n: number): string {
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /** ET + UTC so the instant is unambiguous without a per-user timezone. */
  private fmtDate(d: Date): string {
    const et = d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const utc = d.toLocaleString('en-US', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${et} ET (${utc} UTC)`;
  }

  private itemName(a: Auction): string {
    return a.title || 'your Hermes auction item';
  }

  private async send(user: User | null, notice: Notice): Promise<void> {
    if (!user?.email) return;
    try {
      await this.queueService.addEmailJob(
        {
          toAddress: [user.email],
          subject: notice.subject,
          params: {
            logoUrl: this.logoUrl(),
            heading: notice.heading,
            userName: user.username || 'there',
            intro: notice.intro,
            itemName: notice.itemName ?? '',
            rows: notice.rows ?? [],
            ctaLabel: notice.ctaLabel ?? '',
            ctaUrl: notice.ctaUrl ?? '',
            footnote: notice.footnote ?? '',
          },
        } as never,
        EmailType.HermesAuctionNotice,
      );
    } catch (err) {
      this.logger.warn(
        `Hermes email "${notice.subject}" to ${user.id} failed: ${(err as Error).message}`,
      );
    }
  }

  private async bidderIds(auctionId: string): Promise<string[]> {
    const rows = await this.bidRepository
      .createQueryBuilder('b')
      .select('DISTINCT b.user_id', 'userId')
      .where('b.auction_id = :id', { id: auctionId })
      .getRawMany<{ userId: string }>();
    return rows.map((r) => r.userId);
  }

  async notifyOutbid(params: {
    previousLeaderUserId: string;
    auctionId: string;
  }): Promise<void> {
    const a = await this.auctionRepository.findOne({
      where: { id: params.auctionId },
    });
    const user = await this.userRepository.findOne({
      where: { id: params.previousLeaderUserId },
    });
    if (!a || !user) return;
    const current = a.currentBidUsd ? Number(a.currentBidUsd) : null;
    await this.send(user, {
      subject: `You've been outbid: ${this.itemName(a)}`,
      heading: "You've been outbid",
      intro:
        'Someone placed a higher max bid. Raise yours before the clock runs out — we bid for you up to your max.',
      itemName: this.itemName(a),
      rows: [
        {
          label: 'Current bid',
          value: this.fmtUsd(current ?? Number(a.startingPriceUsd)),
        },
        {
          label: 'Min next bid',
          value: this.fmtUsd(minNextBid(current, Number(a.startingPriceUsd))),
        },
        { label: 'Ends', value: this.fmtDate(a.endsAt) },
      ],
      ctaLabel: 'Bid again',
      ctaUrl: this.auctionUrl(a.id),
      footnote:
        'If you bid with USDC, your escrow for this auction is being returned to your wallet.',
    });
  }

  async notifyClosingSoon(auctionId: string): Promise<void> {
    const a = await this.auctionRepository.findOne({
      where: { id: auctionId },
    });
    if (!a || a.endsAt.getTime() < Date.now()) return;
    const ids = await this.bidderIds(auctionId);
    if (ids.length === 0) return;
    const users = await this.userRepository.find({ where: { id: In(ids) } });
    const current = a.currentBidUsd
      ? Number(a.currentBidUsd)
      : Number(a.startingPriceUsd);
    await Promise.allSettled(
      users.map((u) =>
        this.send(u, {
          subject: `Closing in 1 hour: ${this.itemName(a)}`,
          heading: 'Closing in about an hour',
          intro: `${
            u.id === a.currentLeaderUserId
              ? "You're the high bidder right now."
              : "You're not the high bidder right now."
          } Bids in the final minute extend the clock, so there's always time to respond.`,
          itemName: this.itemName(a),
          rows: [
            { label: 'Current bid', value: this.fmtUsd(current) },
            { label: 'Ends', value: this.fmtDate(a.endsAt) },
          ],
          ctaLabel: 'View auction',
          ctaUrl: this.auctionUrl(a.id),
        }),
      ),
    );
  }

  async notifyWinner(params: {
    auction: Auction;
    winnerUserId: string;
    outcome: 'paid' | 'processing' | 'action_required' | 'failed';
  }): Promise<void> {
    const a = params.auction;
    const user = await this.userRepository.findOne({
      where: { id: params.winnerUserId },
    });
    if (!user) return;
    const hammer = Number(a.winningAmountUsd ?? a.currentBidUsd ?? 0);
    const rows: NoticeRow[] = [
      { label: 'Winning bid', value: this.fmtUsd(hammer) },
      { label: 'Shipping', value: this.fmtUsd(Number(a.shippingUsd ?? 0)) },
    ];
    if (Number(a.cardFeeUsd ?? 0) > 0) {
      rows.push({
        label: 'Card processing',
        value: this.fmtUsd(Number(a.cardFeeUsd)),
      });
    }
    rows.push({
      label: 'Total',
      value: this.fmtUsd(Number(a.totalChargedUsd ?? 0)),
    });
    if (a.paymentMethod) {
      rows.push({ label: 'Paid with', value: METHOD_LABEL[a.paymentMethod] });
    }

    if (params.outcome === 'paid' || params.outcome === 'processing') {
      await this.send(user, {
        subject: `You won: ${this.itemName(a)}`,
        heading: 'You won! 🏆',
        intro:
          params.outcome === 'paid'
            ? "Your payment went through. We'll email tracking as soon as it ships."
            : "Your bank payment is processing (ACH usually clears in 1–4 business days). We'll ship once it clears.",
        itemName: this.itemName(a),
        rows,
        ctaLabel: 'View your win',
        ctaUrl: this.payUrl(a.id),
        footnote:
          'Zero buyer premium. You only paid the hammer price plus shipping.',
      });
      return;
    }

    const due = a.paymentDueAt ? this.fmtDate(a.paymentDueAt) : 'soon';
    await this.send(user, {
      subject: `Action needed: complete payment for ${this.itemName(a)}`,
      heading: 'You won — finish your payment',
      intro:
        params.outcome === 'action_required'
          ? 'Your bank needs you to confirm this charge.'
          : "We couldn't charge your saved payment method.",
      itemName: this.itemName(a),
      rows: [...rows, { label: 'Pay by', value: due }],
      ctaLabel: 'Complete payment',
      ctaUrl: this.payUrl(a.id),
      footnote:
        "If payment isn't completed by the deadline, the item may be offered to the next bidder.",
    });
  }

  async notifyLosers(params: {
    auction: Auction;
    winnerUserId: string | null;
  }): Promise<void> {
    const a = params.auction;
    const ids = (await this.bidderIds(a.id)).filter(
      (id) => id !== params.winnerUserId,
    );
    if (ids.length === 0) return;
    const users = await this.userRepository.find({ where: { id: In(ids) } });
    const sold = !!params.winnerUserId;
    await Promise.allSettled(
      users.map((u) =>
        this.send(u, {
          subject: `Auction ended: ${this.itemName(a)}`,
          heading: 'This auction has ended',
          intro: sold
            ? "You didn't win this one. Nothing was charged, and any USDC escrow has been returned to your wallet."
            : 'The reserve was not met, so this item did not sell. Nothing was charged, and any USDC escrow has been returned.',
          itemName: this.itemName(a),
          rows: sold
            ? [
                {
                  label: 'Winning bid',
                  value: this.fmtUsd(Number(a.winningAmountUsd ?? 0)),
                },
              ]
            : [],
          ctaLabel: 'Browse live auctions',
          ctaUrl: `${this.site()}/auctions`,
        }),
      ),
    );
  }

  /** Lets the house know an item sold and where to ship it. */
  async notifyAdminSold(auction: Auction): Promise<void> {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    if (!adminEmail) return;
    const winner = auction.winnerUserId
      ? await this.userRepository.findOne({
          where: { id: auction.winnerUserId },
        })
      : null;
    const addr = auction.shippingAddress;
    await this.send({ email: adminEmail, username: 'Hermes team' } as User, {
      subject: `Sold: ${this.itemName(auction)} — ${this.fmtUsd(Number(auction.winningAmountUsd ?? 0))}`,
      heading: 'An auction sold',
      intro: `Won by ${winner?.username ?? 'a bidder'}. Ship to the address below, then mark it shipped in admin.`,
      itemName: this.itemName(auction),
      rows: [
        {
          label: 'Winning bid',
          value: this.fmtUsd(Number(auction.winningAmountUsd ?? 0)),
        },
        {
          label: 'Collected',
          value: this.fmtUsd(Number(auction.totalChargedUsd ?? 0)),
        },
        {
          label: 'Method',
          value: METHOD_LABEL[auction.paymentMethod ?? ''] ?? '—',
        },
        ...(addr
          ? [
              {
                label: 'Ship to',
                value: [
                  `${addr.firstName} ${addr.lastName}`.trim(),
                  addr.addressLine1,
                  addr.addressLine2,
                  `${addr.city}, ${addr.state} ${addr.zipCode}`,
                  addr.country,
                ]
                  .filter(Boolean)
                  .join(', '),
              },
            ]
          : []),
      ],
      ctaLabel: 'Open in admin',
      ctaUrl: `${this.site()}/analytics?tab=auctions&auction=${auction.id}`,
    });
  }

  async notifyShipped(auction: Auction): Promise<void> {
    if (!auction.winnerUserId) return;
    const user = await this.userRepository.findOne({
      where: { id: auction.winnerUserId },
    });
    await this.send(user, {
      subject: `Shipped: ${this.itemName(auction)}`,
      heading: 'Your item shipped 📦',
      intro: 'Your Hermes Auctions win is on its way.',
      itemName: this.itemName(auction),
      rows: [
        { label: 'Carrier', value: auction.carrier ?? '—' },
        { label: 'Tracking', value: auction.trackingNumber ?? '—' },
      ],
      ctaLabel: 'View your win',
      ctaUrl: this.payUrl(auction.id),
    });
  }
}
