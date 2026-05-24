import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ConflictException,
  ForbiddenException,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrizeConfiguration } from './entities/prize-configuration.entity';
import { PrizeRedemption } from './entities/prize-redemption.entity';
import { PrizeOrder } from './entities/prize-order.entity';
import { PrizeItemEbaySoldListing } from './entities/prize-item-ebay-sold-listing.entity';
import { PrizeItemEbaySoldListingReport } from './entities/prize-item-ebay-sold-listing-report.entity';
import { PrizeItemEbaySyncState } from './entities/prize-item-ebay-sync-state.entity';
import { ItemConfigurationImage } from './entities/item-configuration-image.entity';
import { ShopSettings } from './entities/shop-settings.entity';
import { PrizeEngagementService } from './prize-engagement.service';
import { User } from '../users/entities/user.entity';
import { WalletsService } from '../wallets/wallets.service';
import { EmailsService } from '../emails/email.service';
import { CurrencyType } from '../enums/currency.enum';
import { TransactionType } from '../enums/transaction-type.enum';
import {
  PromoCodeService,
  DiscountValidationResult,
} from '../promo-code/promo-code.service';
import {
  PrizeConfigurationDto,
  CreatePrizeTierDto,
  UpdatePrizeTierDto,
  PrizeProgressDto,
  PrizeItemDto,
  SubmitPrizeRedemptionDto,
  UserRedemptionResponseDto,
  AdminRedemptionResponseDto,
  UpdateRedemptionStatusDto,
  ShippingStatus,
  CreatePrizeOrderDto,
  PrizeOrderResponseDto,
  EbayMarketHistoryDto,
  AdminEbayMarketSoldListingDto,
  ModerateEbaySoldListingDto,
  ReportEbaySoldListingDto,
  EbayMarketSoldListingDto,
  EbayMarketSummaryDto,
  EbayMarketWindowAverageDto,
  AdminReportedEbaySoldListingDto,
  MakeOfferDto,
  CounterOfferDto,
  MarkAsShippedDto,
  PrizeDisplayOrderUpdateDto,
  UpdateShopSettingsDto,
} from './dto';
import { PrizeCategory } from './enums/prize-category.enum';
import { PrizePurchaseOption } from './enums/prize-purchase-option.enum';
import { PrizeSaleType } from './enums/prize-sale-type.enum';
import { PrizeBrand } from './enums/prize-brand.enum';
import { stripe } from 'src/integrations/stripe';
import { AuctionsService } from '../auctions/auctions.service';
import { UserRole } from '../enums/user-role.enum';
import { InboxService } from '../inbox/inbox.service';
import {
  BUYER_PROCESSING_FEE_PERCENT,
  calculateBuyerItemFeeCents,
  calculateRewardCadeCoinsFromCents,
  calculateSellerFeeCents,
  getBuyerFeePercentForStripeMethod,
  getEffectiveSellerFeePercent,
} from 'src/common/utils/fee-utils';

type EbayMarketWindowKey = '7d' | '30d' | '90d' | '180d' | '365d' | 'all';

const EBAY_MARKET_WINDOWS: Array<{
  key: Exclude<EbayMarketWindowKey, 'all'>;
  days: number;
}> = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: '180d', days: 180 },
  { key: '365d', days: 365 },
];

const EBAY_FLAG_SOCIALS_KEY_SOLD_AVG = '_ff_ebaySoldAvg';
const EBAY_FLAG_SOCIALS_KEY_SOLD_AVG_ADMIN_ONLY = '_ff_ebaySoldAvgAdminOnly';
const EBAY_FLAG_SOCIALS_KEY_MANUAL_SYNC = '_ff_ebayManualSync';
const EBAY_FLAG_SOCIALS_KEY_ITEM_CARD_BUTTON_PUBLIC = '_ff_ebayItemCardButtonPublic';

/**
 * Service for managing prize configuration and calculating user progress.
 * Implements data hardening: updates create new rows instead of modifying existing ones.
 */
@Injectable()
export class PrizeService implements OnModuleInit {
  private readonly logger = new Logger(PrizeService.name);
  private stripe: Stripe;

  /**
   * Cached value of the platform-level "CardCade accepts USDC" flag,
   * derived from `shop_settings.cardcade.cryptoPaymentsEnabled` AND a
   * non-empty `cryptoWalletAddress`. The cache lives for `CARDCADE_FLAG_TTL_MS`
   * so high-traffic list endpoints don't hammer `shop_settings` per row in
   * `mapToDto`. Reads are sync — if the cache is stale we kick off a
   * non-blocking refresh and return the previous value (false on cold
   * start). Admin toggles take effect within ~60s on every endpoint.
   */
  private cardcadeCryptoCache: { value: boolean; expiresAt: number } = {
    value: false,
    expiresAt: 0,
  };
  private cardcadeCryptoRefreshing = false;
  private static readonly CARDCADE_FLAG_TTL_MS = 60_000;

  constructor(
    @InjectRepository(PrizeConfiguration)
    private readonly prizeConfigRepository: Repository<PrizeConfiguration>,
    @InjectRepository(ItemConfigurationImage)
    private readonly itemImageRepository: Repository<ItemConfigurationImage>,
    @InjectRepository(PrizeRedemption)
    private readonly prizeRedemptionRepository: Repository<PrizeRedemption>,
    @InjectRepository(PrizeOrder)
    private readonly prizeOrderRepository: Repository<PrizeOrder>,
    @InjectRepository(PrizeItemEbaySoldListing)
    private readonly ebaySoldListingRepository: Repository<PrizeItemEbaySoldListing>,
    @InjectRepository(PrizeItemEbaySoldListingReport)
    private readonly ebaySoldListingReportRepository: Repository<PrizeItemEbaySoldListingReport>,
    @InjectRepository(PrizeItemEbaySyncState)
    private readonly ebaySyncStateRepository: Repository<PrizeItemEbaySyncState>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ShopSettings)
    private readonly shopSettingsRepository: Repository<ShopSettings>,
    private readonly walletService: WalletsService,
    private readonly configService: ConfigService,
    private readonly emailsService: EmailsService,
    private readonly promoCodeService: PromoCodeService,
    private readonly engagementService: PrizeEngagementService,
    private readonly inboxService: InboxService,
    @Inject(forwardRef(() => AuctionsService))
    private readonly auctionsService: AuctionsService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || '',
    );
  }

  /**
   * Warm the CardCade crypto-flag cache before the app starts handling
   * requests. Without this, the first request after boot would see the
   * default `false` (cold cache), the frontend would cache "card only",
   * and the USDC option would stay hidden until React Query refetched.
   */
  async onModuleInit(): Promise<void> {
    await this.refreshCardcadeCryptoCache();
    this.logger.log(
      `[CardCade flag] warmed on boot: cryptoEnabled=${this.cardcadeCryptoCache.value}`,
    );
  }

  /**
   * Get all active prize tiers visible in the redemption flow, ordered by tier number.
   * Uses display flags (showOnRedemptions/showOnShop), not createdBy ownership.
   */
  async getActivePrizeTiers(): Promise<PrizeConfiguration[]> {
    const tiers = await this.prizeConfigRepository.find({
      where: {
        isActive: true,
        showOnRedemptions: true,
      },
      relations: ['itemImages'],
      order: { prizeTier: 'ASC' },
    });

    if (tiers.length === 0) {
      throw new NotFoundException(
        'No active prize tiers found. Please contact an administrator.',
      );
    }

    return tiers;
  }

  /**
   * Get all active prize tiers as DTOs (public endpoint).
   * Returns items configured to appear in redemptions.
   */
  async getPrizeConfiguration(): Promise<PrizeConfigurationDto[]> {
    const tiers = await this.getActivePrizeTiers();
    return tiers.map((tier) => this.mapToDto(tier));
  }

  /**
   * Get all active prize configurations for admin management.
   * Unlike public redemption config, this does not filter by display flags.
   */
  async getAdminActivePrizeConfigurations(): Promise<PrizeConfigurationDto[]> {
    const configs = await this.prizeConfigRepository.find({
      where: { isActive: true },
      // Eager-load `auction` so the admin Item Settings list / edit dialog
      // can render auction status, current bid, end time, etc. without an
      // extra round-trip per row.
      relations: ['itemImages', 'auction'],
      order: { prizeTier: 'ASC', createdAt: 'DESC' },
    });

    if (configs.length === 0) {
      throw new NotFoundException(
        'No active prize tiers found. Please contact an administrator.',
      );
    }

    return configs.map((c) => this.mapToDto(c));
  }

  /**
   * Get shop settings for a virtual shop by key.
   * Returns defaults if no settings exist yet.
   */
  async getShopSettings(shopKey: string): Promise<ShopSettings> {
    const settings = await this.shopSettingsRepository.findOne({
      where: { shopKey },
    });

    if (settings) {
      return settings;
    }

    // Return defaults for known shops
    if (shopKey === 'cardcade') {
      const defaults = this.shopSettingsRepository.create({
        shopKey: 'cardcade',
        displayName: "CardCade's Shop",
        profileImageUrl: null,
        socials: null,
        sellerTradingExperience: null,
        city: null,
        state: null,
        country: null,
        cryptoPaymentsEnabled: false,
        cryptoWalletAddress: null,
      });
      return defaults;
    }

    throw new NotFoundException(`Shop settings not found for key: ${shopKey}`);
  }

  async getEbayFeatureFlags(): Promise<{
    ebaySoldAvgEnabled: boolean;
    ebaySoldAvgAdminOnly: boolean;
    ebayManualSyncEnabled: boolean;
    ebayItemCardButtonPublic: boolean;
  }> {
    const settings = await this.getShopSettings('cardcade');
    const socials = settings.socials ?? {};

    return {
      ebaySoldAvgEnabled: this.parseHotfixFeatureFlag(
        socials[EBAY_FLAG_SOCIALS_KEY_SOLD_AVG],
        true,
      ),
      ebaySoldAvgAdminOnly: this.parseHotfixFeatureFlag(
        socials[EBAY_FLAG_SOCIALS_KEY_SOLD_AVG_ADMIN_ONLY],
        false,
      ),
      ebayManualSyncEnabled: this.parseHotfixFeatureFlag(
        socials[EBAY_FLAG_SOCIALS_KEY_MANUAL_SYNC],
        true,
      ),
      ebayItemCardButtonPublic: this.parseHotfixFeatureFlag(
        socials[EBAY_FLAG_SOCIALS_KEY_ITEM_CARD_BUTTON_PUBLIC],
        false,
      ),
    };
  }

  private parseHotfixFeatureFlag(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return fallback;
  }

  /**
   * Update shop settings for a virtual shop. Creates the row if it doesn't exist.
   */
  async updateShopSettings(
    shopKey: string,
    dto: UpdateShopSettingsDto,
  ): Promise<ShopSettings> {
    let settings = await this.shopSettingsRepository.findOne({
      where: { shopKey },
    });

    if (!settings) {
      settings = this.shopSettingsRepository.create({ shopKey });
    }

    if (dto.shopName !== undefined) settings.displayName = dto.shopName;
    if (dto.profileImageUrl !== undefined)
      settings.profileImageUrl = dto.profileImageUrl;
    if (dto.socials !== undefined) settings.socials = dto.socials;
    if (dto.sellerTradingExperience !== undefined)
      settings.sellerTradingExperience = dto.sellerTradingExperience;
    if (dto.city !== undefined) settings.city = dto.city;
    if (dto.state !== undefined) settings.state = dto.state;
    if (dto.country !== undefined) settings.country = dto.country;
    if (dto.cryptoPaymentsEnabled !== undefined)
      settings.cryptoPaymentsEnabled = dto.cryptoPaymentsEnabled;
    if (dto.cryptoWalletAddress !== undefined) {
      // Treat empty string the same as null so admins can clear the field
      // from the UI without sending an explicit null.
      const trimmed = (dto.cryptoWalletAddress ?? '').trim();
      settings.cryptoWalletAddress = trimmed.length > 0 ? trimmed : null;
    }

    const saved = await this.shopSettingsRepository.save(settings);

    // If we just touched the CardCade row, refresh the in-memory flag
    // immediately so the next prize-list response reflects the change
    // without waiting for the 60s TTL to expire.
    if (shopKey === 'cardcade') {
      await this.refreshCardcadeCryptoCache();
    }

    return saved;
  }

  /**
   * Get the count of active listed items for a seller.
   * Mirrors the visibility rules used by the public shop page (which also
   * hides items with stock <= 0) so the count shown on profiles / shop
   * cards matches what the user sees when they open the shop.
   */
  async getSellerListedItemCount(sellerId: string): Promise<number> {
    return this.prizeConfigRepository
      .createQueryBuilder('p')
      .where('p.created_by = :sellerId', { sellerId })
      .andWhere('p.is_active = :isActive', { isActive: true })
      .andWhere('p.show_on_shop = :showOnShop', { showOnShop: true })
      .andWhere('p.stock > 0')
      .getCount();
  }

  /**
   * Public: list seller shops that have active shop items.
   */
  async getSellerShops(limit?: number): Promise<
    Array<{
      id: string;
      username: string;
      displayName: string;
      profileImageUrl: string | null;
      itemCount: number;
      totalViews: number;
      totalWatchers: number;
    }>
  > {
    // Count items the same way the public shop page lists them.
    // The frontend hides items with stock <= 0, so the count must too,
    // otherwise the number on the shop card won't match the items shown.
    const qb = this.userRepository
      .createQueryBuilder('u')
      .innerJoin(
        PrizeConfiguration,
        'p',
        'p.created_by = u.id AND p.is_active = :isActive AND p.show_on_shop = :showOnShop AND p.stock > 0',
        {
          isActive: true,
          showOnShop: true,
        },
      )
      .where('u.is_seller = :isSeller', { isSeller: true })
      .andWhere('u.is_active = :isUserActive', { isUserActive: true })
      .select('u.id', 'id')
      .addSelect('u.username', 'username')
      .addSelect('COALESCE(u.shop_name, u.name, u.username)', 'displayName')
      .addSelect('u.profile_image_url', 'profileImageUrl')
      .addSelect('COUNT(p.id)', 'itemCount')
      .addSelect('COALESCE(SUM(p.view_count), 0)', 'totalViews')
      .addSelect('COALESCE(SUM(p.watcher_count), 0)', 'totalWatchers')
      .groupBy('u.id')
      .addGroupBy('COALESCE(u.shop_name, u.name, u.username)')
      .addGroupBy('u.profile_image_url');

    if (limit) {
      // Reserve one slot for the CardCade shop that is prepended below
      qb.orderBy('RANDOM()').limit(Math.max(limit - 1, 0));
    } else {
      qb.orderBy('COALESCE(u.shop_name, u.name, u.username)', 'ASC');
    }

    const rows = await qb.getRawMany();

    // Load CardCade shop settings from DB (or use defaults)
    let cardcadeSettings: ShopSettings;
    try {
      cardcadeSettings = await this.getShopSettings('cardcade');
    } catch {
      cardcadeSettings = {
        shopKey: 'cardcade',
        displayName: 'CardCade Shop',
        profileImageUrl: null,
      } as ShopSettings;
    }

    // CardCade items are admin-owned (created_by IS NULL). Use the same
    // visibility rules as the public shop page (which also hides items
    // with stock <= 0) so the count matches what the user actually sees.
    const cardcadeAgg = await this.prizeConfigRepository
      .createQueryBuilder('p')
      .where('p.created_by IS NULL')
      .andWhere('p.is_active = :isActive', { isActive: true })
      .andWhere('p.show_on_shop = :showOnShop', { showOnShop: true })
      .andWhere('p.stock > 0')
      .select('COUNT(p.id)', 'itemCount')
      .addSelect('COALESCE(SUM(p.view_count), 0)', 'totalViews')
      .addSelect('COALESCE(SUM(p.watcher_count), 0)', 'totalWatchers')
      .getRawOne<{
        itemCount: string;
        totalViews: string;
        totalWatchers: string;
      }>();
    const cardcadeItemCount = Number(cardcadeAgg?.itemCount || 0);
    const cardcadeTotalViews = Number(cardcadeAgg?.totalViews || 0);
    const cardcadeTotalWatchers = Number(cardcadeAgg?.totalWatchers || 0);

    const result = [
      {
        id: 0,
        username: 'cardcade',
        displayName: cardcadeSettings.displayName || 'CardCade Shop',
        profileImageUrl: cardcadeSettings.profileImageUrl || null,
        itemCount: cardcadeItemCount,
        totalViews: cardcadeTotalViews,
        totalWatchers: cardcadeTotalWatchers,
      },
      ...rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.displayName || row.username,
        profileImageUrl: row.profileImageUrl || null,
        itemCount: Number(row.itemCount || 0),
        totalViews: Number(row.totalViews || 0),
        totalWatchers: Number(row.totalWatchers || 0),
      })),
    ];

    return result;
  }

  /**
   * Public: get all shop items across all sellers.
   * This is for the main "Shop" page in the navbar, showing all available shop items.
   */
  async getAllShopItems(
    requesterId?: string | null,
  ): Promise<PrizeConfigurationDto[]> {
    this.logger.log(
      '[SHOP] getAllShopItems() called - fetching all active shop items',
    );

    // Shop visibility is now controlled only by showOnShop.
    // We intentionally no longer include showOnRedemptions here so redeem-only
    // items can stay off the shop page.
    const sellerItems = await this.prizeConfigRepository.find({
      where: {
        isActive: true,
        showOnShop: true,
      },
      relations: ['creator', 'itemImages', 'auction'],
      order: {
        displayOrderShop: 'ASC',
        createdAt: 'DESC',
      },
    });

    this.logger.log(`[SHOP] Found ${sellerItems.length} active shop items`);
    this.logger.debug(
      `[SHOP] Items breakdown: ${JSON.stringify(sellerItems.map((i) => ({ id: i.id, name: i.name, stock: i.stock, createdBy: i.createdBy })))}`,
    );

    const watched = requesterId
      ? await this.engagementService.getWatchedItemIds(
          requesterId,
          sellerItems.map((i) => i.id),
        )
      : new Set<string>();

    // Pre-load the set of auctions this user has bid on so each item's
    // embedded auction summary can populate `isLeader` / `isBidder` /
    // `currentUserProxyMaxUsd`. One round-trip regardless of list size.
    const auctionIds = sellerItems
      .map((i) => i.auction?.id)
      .filter((id): id is string => !!id);
    const bidderAuctionIds = requesterId
      ? await this.auctionsService.getBidderAuctionIds(requesterId, auctionIds)
      : new Set<string>();

    const dtos = sellerItems.map((item) =>
      this.mapToDto(item, {
        isWatching: watched.has(item.id),
        auctionViewerUserId: requesterId ?? null,
        auctionIsBidder:
          !!item.auction && bidderAuctionIds.has(item.auction.id),
      }),
    );

    return dtos;
  }

  async getShopItemById(
    id: string,
    requesterId?: string | null,
  ): Promise<PrizeConfigurationDto> {
    const item = await this.prizeConfigRepository.findOne({
      where: {
        id,
        isActive: true,
        showOnShop: true,
      },
      relations: ['creator', 'itemImages', 'auction'],
    });

    if (!item) {
      throw new NotFoundException('Shop item not found');
    }

    const watched = requesterId
      ? await this.engagementService.getWatchedItemIds(requesterId, [item.id])
      : new Set<string>();

    const auctionId = item.auction?.id;
    const isBidder =
      !!auctionId && !!requesterId
        ? (
            await this.auctionsService.getBidderAuctionIds(requesterId, [
              auctionId,
            ])
          ).has(auctionId)
        : false;

    return this.mapToDto(item, {
      isWatching: watched.has(item.id),
      auctionViewerUserId: requesterId ?? null,
      auctionIsBidder: isBidder,
    });
  }

  async getItemEbayMarketSummary(
    itemId: string,
    requesterId?: string | null,
  ): Promise<EbayMarketSummaryDto> {
    const item = await this.prizeConfigRepository.findOne({
      where: { id: itemId, isActive: true },
      select: ['id', 'amount', 'ebayMarketLastCalculatedAt', 'showEbayAvgPublicly'],
    });

    // Fetch sync state to get last fetch timestamp
    const syncState = await this.ebaySyncStateRepository.findOne({
      where: { itemId },
      select: ['lastFetchSucceededAt'],
    });

    if (!item) {
      throw new NotFoundException('Shop item not found');
    }

    // Check visibility permissions
    const isAdmin = requesterId
      ? await this.userRepository.findOne({
          where: { id: requesterId, role: UserRole.ADMIN },
          select: ['id'],
        })
      : null;

    // Allow if admin, otherwise check showEbayAvgPublicly flag
    if (!isAdmin && !item.showEbayAvgPublicly) {
      throw new ForbiddenException(
        'eBay market data is not publicly visible for this item',
      );
    }

    // Build query to exclude globally inaccurate listings and pending reports by requester
    let latestQb = this.ebaySoldListingRepository
      .createQueryBuilder('sold')
      .where('sold.item_id = :itemId', { itemId })
      .andWhere('sold.is_inaccurate = false')
      .andWhere('sold.sale_price IS NOT NULL');

    // Exclude pending reports by this requester using subquery
    if (requesterId) {
      const pendingListingRows = await this.ebaySoldListingReportRepository
        .createQueryBuilder('report')
        .select('report.listing_id', 'listingId')
        .where('report.reporter_user_id = :reporterId', {
          reporterId: requesterId,
        })
        .andWhere('report.status = :pendingStatus', {
          pendingStatus: 'pending',
        })
        .getRawMany<{ listingId: string }>();

      const excludedIds = pendingListingRows
        .map((row) => row.listingId)
        .filter(Boolean);
      if (excludedIds.length > 0) {
        latestQb.andWhere('sold.id NOT IN (:...excludedIds)', { excludedIds });
      }
    }

    const latestRows = await latestQb
      .orderBy('COALESCE(sold.date_sold, sold."createdAt")', 'DESC')
      .addOrderBy('sold.id', 'DESC')
      .limit(10)
      .getMany();

    const latestPrices = latestRows
      .map((row) => this.parseNumeric(row.salePrice))
      .filter((value): value is number => value !== null);

    const averagePrice =
      latestPrices.length > 0
        ? this.round2(
            latestPrices.reduce((sum, value) => sum + value, 0) /
              latestPrices.length,
          )
        : null;

    // Extract most recent sale price and date
    const mostRecentListing = latestRows[0] ?? null;
    const mostRecentSalePrice = mostRecentListing
      ? this.parseNumeric(mostRecentListing.salePrice)
      : null;
    const mostRecentSaleDate = mostRecentListing
      ? (mostRecentListing.dateSold ?? mostRecentListing.createdAt)
      : null;

    const now = new Date();
    let qb = this.ebaySoldListingRepository
      .createQueryBuilder('sold')
      .where('sold.item_id = :itemId', { itemId })
      .andWhere('sold.is_inaccurate = false')
      .andWhere('sold.sale_price IS NOT NULL')
      .select('COUNT(*)::int', 'all_count')
      .addSelect('AVG(sold.sale_price)::numeric', 'all_avg');

    // Exclude pending reports by this requester using subquery
    if (requesterId) {
      const pendingListingRows = await this.ebaySoldListingReportRepository
        .createQueryBuilder('report')
        .select('report.listing_id', 'listingId')
        .where('report.reporter_user_id = :reporterId', {
          reporterId: requesterId,
        })
        .andWhere('report.status = :pendingStatus', {
          pendingStatus: 'pending',
        })
        .getRawMany<{ listingId: string }>();

      const excludedIds = pendingListingRows
        .map((row) => row.listingId)
        .filter(Boolean);
      if (excludedIds.length > 0) {
        qb.andWhere('sold.id NOT IN (:...excludedIds)', { excludedIds });
      }
    }

    for (const windowDef of EBAY_MARKET_WINDOWS) {
      const since = new Date(now);
      since.setDate(since.getDate() - windowDef.days);
      const sinceParam = `since_${windowDef.key}`;

      qb.addSelect(
        `COUNT(*) FILTER (WHERE COALESCE(sold.date_sold, sold."createdAt") >= :${sinceParam})::int`,
        `count_${windowDef.key}`,
      ).addSelect(
        `AVG(sold.sale_price) FILTER (WHERE COALESCE(sold.date_sold, sold."createdAt") >= :${sinceParam})::numeric`,
        `avg_${windowDef.key}`,
      );

      qb.setParameter(sinceParam, since);
    }

    const stats = await qb.getRawOne<Record<string, unknown>>();

    const windows: EbayMarketWindowAverageDto[] = [
      ...EBAY_MARKET_WINDOWS.map((windowDef) => ({
        window: windowDef.key,
        soldCount: this.parseCount(stats?.[`count_${windowDef.key}`]),
        averagePrice: this.parseNumeric(stats?.[`avg_${windowDef.key}`]),
      })),
      {
        window: 'all',
        soldCount: this.parseCount(stats?.all_count),
        averagePrice: this.parseNumeric(stats?.all_avg),
      },
    ];

    // Prize `amount` is stored in CadeCoins (50 coins = $1), while sold-listing
    // analytics are USD. Convert before computing market delta.
    const listingPriceCoins = this.parseNumeric(item.amount);
    const listingPrice =
      listingPriceCoins !== null ? this.round2(listingPriceCoins / 50) : null;
    const percentDifference =
      listingPrice !== null && averagePrice !== null && averagePrice > 0
        ? this.round2(((listingPrice - averagePrice) / averagePrice) * 100)
        : null;

    return {
      itemId,
      listingPrice,
      averagePrice,
      soldCountUsed: latestPrices.length,
      percentDifference,
      lastCalculatedAt: item.ebayMarketLastCalculatedAt ?? null,
      lastFetchedAt: syncState?.lastFetchSucceededAt ?? null,
      totalValidSoldCount: this.parseCount(stats?.all_count),
      mostRecentSalePrice,
      mostRecentSaleDate,
      windows,
    };
  }

  async getItemEbayMarketHistory(
    itemId: string,
    limit?: number,
    requesterId?: string | null,
  ): Promise<EbayMarketHistoryDto> {
    const normalizedLimit = Math.max(1, Math.min(240, limit ?? 120));
    const summary = await this.getItemEbayMarketSummary(itemId, requesterId);

    let qb = this.ebaySoldListingRepository
      .createQueryBuilder('sold')
      .where('sold.item_id = :itemId', { itemId })
      .andWhere('sold.is_inaccurate = false')
      .andWhere('sold.sale_price IS NOT NULL');

    // Exclude pending reports by this requester using subquery
    if (requesterId) {
      const pendingListingRows = await this.ebaySoldListingReportRepository
        .createQueryBuilder('report')
        .select('report.listing_id', 'listingId')
        .where('report.reporter_user_id = :reporterId', {
          reporterId: requesterId,
        })
        .andWhere('report.status = :pendingStatus', {
          pendingStatus: 'pending',
        })
        .getRawMany<{ listingId: string }>();

      const excludedIds = pendingListingRows
        .map((row) => row.listingId)
        .filter(Boolean);
      if (excludedIds.length > 0) {
        qb.andWhere('sold.id NOT IN (:...excludedIds)', { excludedIds });
      }
    }

    const rows = await qb
      .orderBy('COALESCE(sold.date_sold, sold."createdAt")', 'DESC')
      .addOrderBy('sold.id', 'DESC')
      .limit(normalizedLimit)
      .getMany();

    const listings: EbayMarketSoldListingDto[] = rows.map((row) => ({
      id: row.id,
      providerItemId: row.providerItemId,
      soldTitle: row.soldTitle,
      salePrice: this.parseNumeric(row.salePrice) ?? 0,
      currencySymbol: row.currencySymbol,
      dateSold: row.dateSold,
      imageUrl: row.imageUrl,
      listingUrl: row.listingUrl,
      itemCondition: row.itemCondition,
      buyingFormat: row.buyingFormat,
      shippingPrice: this.parseNumeric(row.shippingPrice),
    }));

    return {
      itemId,
      summary,
      listings,
    };
  }

  async getItemEbaySoldListingsForAdmin(
    itemId: string,
    limit?: number,
    includeInaccurate: boolean = true,
  ): Promise<AdminEbayMarketSoldListingDto[]> {
    const item = await this.prizeConfigRepository.findOne({
      where: { id: itemId },
      select: ['id'],
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    const normalizedLimit = Math.max(1, Math.min(500, limit ?? 240));
    const qb = this.ebaySoldListingRepository
      .createQueryBuilder('sold')
      .where('sold.item_id = :itemId', { itemId })
      .andWhere('sold.sale_price IS NOT NULL')
      .orderBy('COALESCE(sold.date_sold, sold."createdAt")', 'DESC')
      .limit(normalizedLimit);

    if (!includeInaccurate) {
      qb.andWhere('sold.is_inaccurate = false');
    }

    const rows = await qb.getMany();
    return rows.map((row) => this.mapSoldListingToAdminDto(row));
  }

  async moderateEbaySoldListing(
    listingId: string,
    adminUserId: string,
    dto: ModerateEbaySoldListingDto,
  ): Promise<AdminEbayMarketSoldListingDto> {
    const listing = await this.ebaySoldListingRepository.findOne({
      where: { id: listingId },
    });

    if (!listing) {
      throw new NotFoundException('Sold listing not found');
    }

    const now = new Date();
    if (dto.isInaccurate) {
      listing.isInaccurate = true;
      listing.inaccurateReason = dto.reason?.trim() || null;
      listing.inaccurateFlaggedByUserId = adminUserId;
      listing.inaccurateFlaggedAt = now;
    } else {
      listing.isInaccurate = false;
      listing.inaccurateReason = null;
      listing.inaccurateFlaggedByUserId = null;
      listing.inaccurateFlaggedAt = null;
    }

    const saved = await this.ebaySoldListingRepository.save(listing);
    return this.mapSoldListingToAdminDto(saved);
  }

  async getReportedEbaySoldListingsForAdmin(
    limit?: number,
  ): Promise<AdminReportedEbaySoldListingDto[]> {
    const normalizedLimit = Math.max(1, Math.min(500, limit ?? 240));

    // Fetch pending reports with their related sold listings
    const reports = await this.ebaySoldListingReportRepository.find({
      where: { status: 'pending' },
      relations: ['listing', 'listing.item', 'reporterUser'],
      order: { createdAt: 'DESC' },
      take: normalizedLimit,
    });

    return reports.map((report) => ({
      ...this.mapSoldListingToAdminDto(report.listing),
      itemId: report.listing.itemId,
      itemName: report.listing.item?.name || 'Unknown Item',
      itemImageUrl: report.listing.item?.imageUrl || null,
      flaggedByUsername: report.reporterUser?.username || null,
      flaggedByEmail: report.reporterUser?.email || null,
      inaccurateFlaggedAt: report.createdAt,
      inaccurateReason: report.reason || null,
    }));
  }

  async deleteEbaySoldListingForAdmin(
    listingId: string,
  ): Promise<{ success: true; listingId: string }> {
    const listing = await this.ebaySoldListingRepository.findOne({
      where: { id: listingId },
      select: ['id'],
    });

    if (!listing) {
      throw new NotFoundException('Sold listing not found');
    }

    await this.ebaySoldListingRepository.delete({ id: listingId });
    return { success: true, listingId };
  }

  async updateItemEbaySearchQuery(
    itemId: string,
    ebaySearchQuery: string | null,
  ): Promise<{ id: string; ebaySearchQuery: string | null }> {
    const item = await this.prizeConfigRepository.findOne({
      where: { id: itemId },
      select: ['id'],
    });

    if (!item) {
      throw new NotFoundException('Item not found');
    }

    const normalized = ebaySearchQuery?.trim() || null;
    await this.prizeConfigRepository.update(itemId, {
      ebaySearchQuery: normalized,
    });
    return { id: itemId, ebaySearchQuery: normalized };
  }

  async deleteAllItemEbaySoldListings(
    itemId: string,
  ): Promise<{ deleted: number }> {
    const item = await this.prizeConfigRepository.findOne({
      where: { id: itemId },
      select: ['id'],
    });

    if (!item) {
      throw new NotFoundException('Item not found');
    }

    const result = await this.ebaySoldListingRepository.delete({ itemId });

    // Reset sync state so next sync starts fresh
    await this.ebaySyncStateRepository.update(
      { itemId },
      {
        lastFetchSucceededAt: null,
        lastSeenSoldAt: null,
        lastSeenProviderItemId: null,
        nextFetchAt: null,
        lastCalculatedAt: null,
      },
    );

    await this.prizeConfigRepository.update(itemId, {
      ebayMarketLastCalculatedAt: null,
    });

    return { deleted: result.affected ?? 0 };
  }

  async bulkDeleteEbaySoldListings(
    listingIds: string[],
  ): Promise<{ deleted: number }> {
    const result = await this.ebaySoldListingRepository.delete({
      id: In(listingIds),
    });
    return { deleted: result.affected ?? 0 };
  }

  async bulkModerateEbaySoldListings(
    listingIds: string[],
    adminUserId: string,
    dto: { isInaccurate: boolean; reason?: string },
  ): Promise<{ updated: number }> {
    const now = new Date();
    const updateData: Partial<PrizeItemEbaySoldListing> = {
      isInaccurate: dto.isInaccurate,
      inaccurateReason: dto.isInaccurate ? (dto.reason?.trim() || null) : null,
      inaccurateFlaggedByUserId: dto.isInaccurate ? adminUserId : null,
      inaccurateFlaggedAt: dto.isInaccurate ? now : null,
    };

    const result = await this.ebaySoldListingRepository.update(
      { id: In(listingIds) },
      updateData,
    );
    return { updated: result.affected ?? 0 };
  }

  /**
   * Admin action: Bulk update public visibility of eBay sold average data.
   * Controls whether the eBay market data is shown to all users (not just admins)
   * on item cards. Respects the global feature flags but allows per-item override.
   */
  async bulkUpdateEbayPublicVisibility(
    itemIds: string[],
    adminUserId: string,
    dto: { showPublicly: boolean },
  ): Promise<{ updated: number }> {
    this.logger.log(
      `[bulkUpdateEbayPublicVisibility] Updating ${itemIds.length} items, showPublicly=${dto.showPublicly}`,
    );
    this.logger.debug(
      `[bulkUpdateEbayPublicVisibility] Item IDs: ${itemIds.join(', ')}`,
    );

    const result = await this.prizeConfigRepository.update(
      { id: In(itemIds) },
      { 
        showEbayAvgPublicly: dto.showPublicly,
        updatedBy: adminUserId,
      },
    );

    this.logger.log(
      `[bulkUpdateEbayPublicVisibility] Updated ${result.affected ?? 0} items`,
    );

    return { updated: result.affected ?? 0 };
  }

  /**
   * Admin action: Approve a pending report by removing the listing universally.
   * Sets the listing as globally inaccurate and marks all pending reports for it as approved.
   */
  async approveEbaySoldListingReport(
    listingId: string,
    adminUserId: string,
    reason?: string,
  ): Promise<AdminEbayMarketSoldListingDto> {
    const listing = await this.ebaySoldListingRepository.findOne({
      where: { id: listingId },
    });

    if (!listing) {
      throw new NotFoundException('Sold listing not found');
    }

    const now = new Date();
    listing.isInaccurate = true;
    listing.inaccurateReason = reason?.trim() || null;
    listing.inaccurateFlaggedByUserId = adminUserId;
    listing.inaccurateFlaggedAt = now;
    const updatedListing = await this.ebaySoldListingRepository.save(listing);

    // Mark all pending reports for this listing as approved
    await this.ebaySoldListingReportRepository.update(
      { listingId, status: 'pending' },
      {
        status: 'approved',
        resolvedAt: now,
        resolvedByUserId: adminUserId,
        resolutionNote: reason || null,
      },
    );

    return this.mapSoldListingToAdminDto(updatedListing);
  }

  /**
   * Admin action: Reject all pending reports for a listing.
   * Marks pending reports as rejected but does not change global visibility.
   */
  async rejectEbaySoldListingReports(
    listingId: string,
    adminUserId: string,
    reason?: string,
  ): Promise<{ success: true; rejectedCount: number }> {
    const now = new Date();
    const result = await this.ebaySoldListingReportRepository.update(
      { listingId, status: 'pending' },
      {
        status: 'rejected',
        resolvedAt: now,
        resolvedByUserId: adminUserId,
        resolutionNote: reason || null,
      },
    );

    return {
      success: true,
      rejectedCount: result.affected || 0,
    };
  }

  async reportEbaySoldListing(
    listingId: string,
    userId: string,
    dto: ReportEbaySoldListingDto,
  ): Promise<{ success: true; listingId: string }> {
    const listing = await this.ebaySoldListingRepository.findOne({
      where: { id: listingId },
    });

    if (!listing) {
      throw new NotFoundException('Sold listing not found');
    }

    // Create or update pending report for this user and listing
    const existingReport = await this.ebaySoldListingReportRepository.findOne({
      where: {
        listingId,
        reporterUserId: userId,
        status: 'pending',
      },
    });

    if (existingReport) {
      // Update existing pending report reason and timestamp
      existingReport.reason =
        dto.reason?.trim() || existingReport.reason || null;
      existingReport.updatedAt = new Date();
      await this.ebaySoldListingReportRepository.save(existingReport);
    } else {
      // Create new pending report
      const report = this.ebaySoldListingReportRepository.create({
        listingId,
        reporterUserId: userId,
        reason: dto.reason?.trim() || null,
        status: 'pending',
      });
      await this.ebaySoldListingReportRepository.save(report);
    }

    // Notify admins about the report
    await this.notifyAdminsAboutReportedSoldListing(listing, userId);

    return {
      success: true,
      listingId,
    };
  }

  private async notifyAdminsAboutReportedSoldListing(
    listing: PrizeItemEbaySoldListing,
    reporterId: string,
  ): Promise<void> {
    try {
      const [reporter, admins, item] = await Promise.all([
        this.userRepository.findOne({
          where: { id: reporterId },
          select: ['id', 'username', 'email'],
        }),
        this.userRepository.find({
          where: { role: UserRole.ADMIN, isActive: true },
          select: ['id'],
        }),
        this.prizeConfigRepository.findOne({
          where: { id: listing.itemId },
          select: ['id', 'name'],
        }),
      ]);

      const adminIds = admins
        .map((admin) => admin.id)
        .filter((adminId) => adminId && adminId !== reporterId);

      if (adminIds.length === 0) {
        return;
      }

      const itemName = item?.name || listing.searchQuery || 'Unknown item';
      const reporterLabel = reporter?.username || reporter?.email || 'A user';
      const reasonText = listing.inaccurateReason
        ? `Reason: ${listing.inaccurateReason}`
        : 'Reason: not provided';

      const message = [
        `A sold listing was reported for ${itemName}.`,
        `Listing: ${listing.soldTitle}`,
        `Reported by: ${reporterLabel}`,
        reasonText,
        'Open Admin > Reported eBay Listings to review and remove/clear it.',
      ].join('\n');

      await Promise.all(
        adminIds.map((adminId) =>
          this.inboxService.sendSystemMessageToUser(adminId, message),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send sold-listing report notifications for listing ${listing.id}: ${(error as Error)?.message || error}`,
      );
    }
  }

  /**
   * Public: get one seller shop and its active items.
   */
  async getPublicShopByUsername(
    username: string,
    requesterId?: string | null,
  ): Promise<{
    shop: {
      id: string;
      username: string;
      displayName: string;
      profileImageUrl: string | null;
      socials: { [social: string]: string } | null;
      sellerTradingExperience?: string | null;
      city?: string | null;
      state?: string | null;
      country?: string | null;
    };
    items: PrizeConfigurationDto[];
  }> {
    if (username === 'cardcade') {
      // CardCade shop only includes admin-owned shop items.
      // This intentionally decouples CardCade shop from showOnRedemptions so
      // an item can be redeem-only, shop-only, or both.
      const items = await this.prizeConfigRepository.find({
        where: {
          isActive: true,
          showOnShop: true,
          createdBy: IsNull(),
        },
        // Include `creator` for parity with the seller branch, even though
        // CardCade items have a null creator (so sellerCryptoEnabled stays
        // false on those — CardCade isn't a crypto-payout seller).
        relations: ['itemImages', 'auction', 'creator'],
        order: {
          createdAt: 'DESC',
        },
      });

      const sortedSellerItems = this.sortSellerShopItemsBySellerOrder(items);

      // Load CardCade shop settings from DB (or use defaults)
      let cardcadeSettings: ShopSettings;
      try {
        cardcadeSettings = await this.getShopSettings('cardcade');
      } catch {
        cardcadeSettings = {
          shopKey: 'cardcade',
          displayName: "CardCade's Shop",
          profileImageUrl: null,
          socials: null,
          sellerTradingExperience: null,
          city: null,
          state: null,
          country: null,
          cryptoPaymentsEnabled: false,
          cryptoWalletAddress: null,
        } as ShopSettings;
      }

      // CardCade items have no creator, so the per-item sellerCryptoEnabled
      // flag is derived from the platform-level shop settings instead. Only
      // surface USDC checkout when both the toggle is on AND a treasury
      // wallet has actually been configured — otherwise the wallet would
      // see the radio button but the order would fail at quote time.
      const cardcadeCryptoEnabled =
        cardcadeSettings.cryptoPaymentsEnabled &&
        !!cardcadeSettings.cryptoWalletAddress;

      const watched = requesterId
        ? await this.engagementService.getWatchedItemIds(
            requesterId,
            sortedSellerItems.map((i) => i.id),
          )
        : new Set<string>();

      const auctionIds = sortedSellerItems
        .map((i) => i.auction?.id)
        .filter((id): id is string => !!id);
      const bidderAuctionIds = requesterId
        ? await this.auctionsService.getBidderAuctionIds(
            requesterId,
            auctionIds,
          )
        : new Set<string>();

      const response = {
        shop: {
          id: '0',
          username: 'cardcade',
          displayName: cardcadeSettings.displayName || "CardCade's Shop",
          profileImageUrl: cardcadeSettings.profileImageUrl || null,
          socials: cardcadeSettings.socials || null,
          sellerTradingExperience:
            cardcadeSettings.sellerTradingExperience || null,
          city: cardcadeSettings.city || null,
          state: cardcadeSettings.state || null,
          country: cardcadeSettings.country || null,
        },
        items: sortedSellerItems.map((item) =>
          this.mapToDto(item, {
            isWatching: watched.has(item.id),
            auctionViewerUserId: requesterId ?? null,
            auctionIsBidder:
              !!item.auction && bidderAuctionIds.has(item.auction.id),
            sellerCryptoEnabledOverride: cardcadeCryptoEnabled,
          }),
        ),
      };
      this.logger.log(
        `[SHOP] Final shop.socials in response: ${JSON.stringify(response.shop.socials)}`,
      );
      return response;
    } else {
      const seller = await this.userRepository.findOne({
        where: {
          username,
          isSeller: true,
          isActive: true,
        },
      });

      if (!seller) {
        throw new NotFoundException('Seller shop not found');
      }

      const items = await this.prizeConfigRepository.find({
        where: {
          createdBy: seller.id,
          isActive: true,
          showOnShop: true,
        },
        // `creator` is required so mapToDto can derive
        // `sellerCryptoEnabled` from `creator.cryptoPaymentsEnabled`.
        // Without it, the buyer's checkout modal won't show the USDC option.
        relations: ['itemImages', 'auction', 'creator'],
        order: {
          createdAt: 'DESC',
        },
      });

      const sortedSellerItems = this.sortSellerShopItemsBySellerOrder(items);

      this.logger.log(
        `[SHOP] Found ${items.length} shop items for seller ${username}`,
      );
      this.logger.debug(
        `[SHOP] Items for ${username}: ${JSON.stringify(items.map((i) => ({ id: i.id, name: i.name, stock: i.stock, showOnShop: i.showOnShop, createdBy: i.createdBy })))}`,
      );
      this.logger.log(
        `[SHOP] Seller data - id: ${seller.id}, username: ${seller.username}, isSeller: ${seller.isSeller}, role: ${seller.role}`,
      );
      this.logger.log(
        `[SHOP] Seller socials RAW VALUE: ${JSON.stringify(seller.socials)}`,
      );
      this.logger.log(`[SHOP] Seller socials TYPE: ${typeof seller.socials}`);
      this.logger.log(
        `[SHOP] Seller socials IS NULL: ${seller.socials === null}`,
      );
      this.logger.log(
        `[SHOP] Seller socials IS UNDEFINED: ${seller.socials === undefined}`,
      );
      this.logger.log(
        `[SHOP] Seller socials KEYS: ${seller.socials ? Object.keys(seller.socials).join(',') : 'N/A'}`,
      );

      const response = {
        shop: {
          id: seller.id,
          username: seller.username,
          displayName: seller.shopName || seller.name || seller.username,
          profileImageUrl: seller.profileImageUrl || null,
          socials: seller.socials || null,
          sellerTradingExperience: seller.sellerTradingExperience || null,
          city: seller.city || null,
          state: seller.state || null,
          country: seller.country || null,
        },
        items: await this.attachIsWatching(sortedSellerItems, requesterId),
      };
      this.logger.log(
        `[SHOP] Final shop.socials in response: ${JSON.stringify(response.shop.socials)}`,
      );
      return response;
    }
  }

  /**
   * Seller: get my active shop items.
   */
  async getMySellerShopItems(
    sellerId: string,
  ): Promise<PrizeConfigurationDto[]> {
    await this.ensureSeller(sellerId);

    const items = await this.prizeConfigRepository.find({
      where: {
        createdBy: sellerId,
        isActive: true,
        showOnShop: true, // Only show items meant for shop, exclude admin redemptions
      },
      // `creator` is required so mapToDto populates sellerCryptoEnabled,
      // which the buyer's checkout modal uses to show the USDC option.
      relations: ['itemImages', 'auction', 'creator'],
      order: {
        createdAt: 'DESC',
      },
    });

    const sortedSellerItems = this.sortSellerShopItemsBySellerOrder(items);
    return sortedSellerItems.map((item) => this.mapToDto(item));
  }

  /**
   * Seller: create an item in my shop.
   */
  async createMySellerShopItem(
    sellerId: string,
    dto: CreatePrizeTierDto,
  ): Promise<PrizeConfigurationDto> {
    await this.ensureSeller(sellerId);

    // Only PRO sellers can feature items on their profile
    const seller = await this.userRepository.findOne({
      where: { id: sellerId, isActive: true },
    });
    const profileFeatured =
      dto.profileFeatured && seller?.isProSubscriber ? true : false;

    const { displayOrderShop, sellerDisplayOrderShop, ...restDto } = dto;
    const sellerScopedDisplayOrder = sellerDisplayOrderShop ?? displayOrderShop;

    return this.createPrizeTier(
      {
        ...restDto,
        profileFeatured,
        sellerDisplayOrderShop: sellerScopedDisplayOrder,
        showOnShop: true,
        showOnRedemptions: false,
      },
      sellerId, // userId (not used for seller items)
      sellerId, // createdBy - identifies this as a seller item
    );
  }

  /**
   * Seller: update one of my shop items.
   */
  async updateMySellerShopItem(
    sellerId: string,
    itemId: string,
    dto: UpdatePrizeTierDto,
  ): Promise<PrizeConfigurationDto> {
    await this.ensureSeller(sellerId);

    const existing = await this.getPrizeTierById(itemId);
    if (existing.createdBy !== sellerId) {
      throw new ForbiddenException('You can only update your own shop items');
    }

    // Only PRO sellers can feature items on their profile
    const seller = await this.userRepository.findOne({
      where: { id: sellerId, isActive: true },
    });
    const profileFeatured =
      dto.profileFeatured !== undefined
        ? dto.profileFeatured && seller?.isProSubscriber
          ? true
          : false
        : existing.profileFeatured;

    const { displayOrderShop, sellerDisplayOrderShop, ...restDto } = dto;
    const sellerScopedDisplayOrder = sellerDisplayOrderShop ?? displayOrderShop;

    return this.updatePrizeTier(
      itemId,
      {
        ...restDto,
        profileFeatured,
        sellerDisplayOrderShop: sellerScopedDisplayOrder,
        showOnShop: true,
        showOnRedemptions: false,
      },
      sellerId,
    );
  }

  /**
   * Seller: delete one of my shop items (soft delete).
   */
  async deleteMySellerShopItem(
    sellerId: string,
    itemId: string,
  ): Promise<void> {
    await this.ensureSeller(sellerId);

    const existing = await this.getPrizeTierById(itemId);
    if (existing.createdBy !== sellerId) {
      throw new ForbiddenException('You can only delete your own shop items');
    }

    await this.deletePrizeTier(itemId);
  }

  private async ensureSeller(sellerId: string): Promise<void> {
    const seller = await this.userRepository.findOne({
      where: { id: sellerId, isSeller: true, isActive: true },
    });

    if (!seller) {
      throw new ForbiddenException('Seller access required');
    }
  }

  private sortSellerShopItemsBySellerOrder(
    items: PrizeConfiguration[],
  ): PrizeConfiguration[] {
    return items.slice().sort((a, b) => {
      const aOrder =
        a.sellerDisplayOrderShop ??
        a.displayOrderShop ??
        Number.MAX_SAFE_INTEGER;
      const bOrder =
        b.sellerDisplayOrderShop ??
        b.displayOrderShop ??
        Number.MAX_SAFE_INTEGER;

      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  private async isSellerOwnedItem(item: PrizeConfiguration): Promise<boolean> {
    if (!item.createdBy) return false;

    const owner = await this.userRepository.findOne({
      where: { id: item.createdBy },
    });

    return !!owner?.isSeller;
  }

  /**
   * Get a specific prize tier by ID.
   */
  async getPrizeTierById(id: string): Promise<PrizeConfiguration> {
    const tier = await this.prizeConfigRepository.findOne({
      where: { id },
    });

    if (!tier) {
      throw new NotFoundException(`Prize tier with ID ${id} not found`);
    }

    return tier;
  }

  private normalizeItemImageUrls(
    imageUrls?: string[],
    imageUrl?: string | null,
  ): string[] {
    const urlsFromArray = (imageUrls || [])
      .map((url) => (url || '').trim())
      .filter((url) => url.length > 0);

    if (urlsFromArray.length > 0) {
      return urlsFromArray;
    }

    if (imageUrl && imageUrl.trim().length > 0) {
      return [imageUrl.trim()];
    }

    return [];
  }

  private resolveCoverImageIndex(
    imageUrls: string[],
    requestedCoverIndex?: number,
  ): number {
    if (imageUrls.length === 0) {
      return 0;
    }

    const coverIndex = requestedCoverIndex ?? 0;
    if (coverIndex < 0 || coverIndex >= imageUrls.length) {
      throw new BadRequestException(
        `coverImageIndex must be between 0 and ${imageUrls.length - 1}`,
      );
    }

    return coverIndex;
  }

  private ensureImageLimit(imageUrls: string[]): void {
    if (imageUrls.length > 6) {
      throw new BadRequestException('A maximum of 6 item images is allowed');
    }
  }

  private async getItemImagesForPrizeConfig(
    prizeConfigurationId: string,
  ): Promise<ItemConfigurationImage[]> {
    return this.itemImageRepository.find({
      where: { prizeConfigurationId },
      order: { displayOrder: 'ASC' },
    });
  }

  private async saveItemImagesForPrizeConfig(
    prizeConfigurationId: string,
    imageUrls: string[],
    coverImageIndex: number,
  ): Promise<ItemConfigurationImage[]> {
    return this.itemImageRepository.manager.transaction(async (manager) => {
      await manager.delete(ItemConfigurationImage, { prizeConfigurationId });

      if (imageUrls.length === 0) {
        await manager.update(PrizeConfiguration, prizeConfigurationId, {
          coverImageId: null,
          imageUrl: null,
        });
        return [];
      }

      const imagesToCreate = imageUrls.map((url, index) =>
        manager.create(ItemConfigurationImage, {
          prizeConfigurationId,
          imageUrl: url,
          displayOrder: index,
        }),
      );

      const savedImages = await manager.save(
        ItemConfigurationImage,
        imagesToCreate,
      );
      const sortedImages = savedImages.sort(
        (a, b) => a.displayOrder - b.displayOrder,
      );
      const coverImage = sortedImages[coverImageIndex] || sortedImages[0];

      await manager.update(PrizeConfiguration, prizeConfigurationId, {
        coverImageId: coverImage.id,
        imageUrl: coverImage.imageUrl,
      });

      return sortedImages;
    });
  }

  /**
   * Create a new prize tier (used by both admin and seller endpoints).
   *
   * @param dto - Prize tier data
   * @param userId - User ID making the change (for updatedBy tracking)
   * @param createdBy - Optional: ID of the user who owns this item (null for admin redemption items, sellerId for seller shop items)
   */
  async createPrizeTier(
    dto: CreatePrizeTierDto,
    userId: string,
    createdBy: string | null = null,
  ): Promise<PrizeConfigurationDto> {
    // Validate that createdBy is an active seller if provided
    if (createdBy) {
      const seller = await this.userRepository.findOne({
        where: { id: createdBy, isActive: true },
      });

      if (!seller) {
        throw new BadRequestException(
          `User with ID ${createdBy} not found or inactive`,
        );
      }

      if (!seller.isSeller) {
        throw new BadRequestException(
          `User ${seller.username} is not a seller`,
        );
      }
    }

    // Auto-generate tier number if not provided
    let prizeTier = dto.prizeTier;
    if (!prizeTier) {
      // Get the highest tier number and add 1 (scoped by createdBy)
      const query = this.prizeConfigRepository
        .createQueryBuilder('pc')
        .select('MAX(pc.prizeTier)', 'max');

      if (createdBy) {
        query.where('pc.createdBy = :createdBy', { createdBy });
      } else {
        query.where('pc.createdBy IS NULL');
      }

      const maxTier = await query.getRawOne();
      prizeTier = (maxTier?.max || 0) + 1;
    } else {
      // If provided, check if tier number is already active for this scope (admin or seller)
      const existingTier = await this.prizeConfigRepository.findOne({
        where: {
          prizeTier,
          isActive: true,
          createdBy: createdBy, // Scoped per seller or admin (null for admin)
        },
      });

      if (existingTier) {
        throw new ConflictException(
          `Prize tier ${prizeTier} is already active. Please deactivate it first or use update.`,
        );
      }
    }

    // Determine purchase option (default to BOTH)
    const purchaseOption = dto.purchaseOption || PrizePurchaseOption.BOTH;

    // Validate and set amount
    let amount: number;
    if (purchaseOption === PrizePurchaseOption.OFFERS_ONLY) {
      // For offers_only, use 1 as default (admin doesn't need to enter price)
      amount = dto.amount && dto.amount > 0 ? dto.amount : 1;
    } else {
      // For buy_only or both, amount is required and must be positive
      if (!dto.amount || dto.amount <= 0) {
        throw new BadRequestException(
          'Prize amount is required and must be positive for buy_only and both purchase options',
        );
      }
      amount = dto.amount;
    }

    // Amount is always expected in CadeCoins from the frontend
    // Both admin and seller frontends convert USD to CadeCoins before sending

    const normalizedImageUrls = this.normalizeItemImageUrls(
      dto.imageUrls,
      dto.imageUrl,
    );
    this.ensureImageLimit(normalizedImageUrls);

    if (normalizedImageUrls.length === 0) {
      throw new BadRequestException(
        'At least one image is required when creating an item',
      );
    }

    const coverImageIndex = this.resolveCoverImageIndex(
      normalizedImageUrls,
      dto.coverImageIndex,
    );
    const coverImageUrl = normalizedImageUrls[coverImageIndex] || null;

    // Auto-generate display orders for each page where item will be shown
    const category = (dto.category || 'slab') as
      | 'raw'
      | 'slab'
      | 'sealed'
      | 'other';
    const isSellerOwnedItem = !!createdBy;

    let displayOrderShop = dto.displayOrderShop ?? null;
    let sellerDisplayOrderShop = dto.sellerDisplayOrderShop ?? null;

    if (isSellerOwnedItem) {
      // Seller-managed order is seller page only; global shop order remains admin-managed.
      displayOrderShop = null;

      if (!sellerDisplayOrderShop && (dto.showOnShop ?? true)) {
        const maxSellerShop = await this.prizeConfigRepository
          .createQueryBuilder('pc')
          .select('MAX(pc.sellerDisplayOrderShop)', 'max')
          .where('pc.category = :category', { category })
          .andWhere('pc.isActive = :isActive', { isActive: true })
          .andWhere('pc.createdBy = :createdBy', { createdBy })
          .andWhere('pc.showOnShop = :showOnShop', { showOnShop: true })
          .getRawOne();
        sellerDisplayOrderShop = (maxSellerShop?.max || 0) + 1;
      }
    } else if (!displayOrderShop && (dto.showOnShop ?? true)) {
      const maxShop = await this.prizeConfigRepository
        .createQueryBuilder('pc')
        .select('MAX(pc.displayOrderShop)', 'max')
        .where('pc.category = :category', { category })
        .andWhere('pc.isActive = :isActive', { isActive: true })
        .getRawOne();
      displayOrderShop = (maxShop?.max || 0) + 1;
    }

    let displayOrderRedemptions = dto.displayOrderRedemptions ?? null;
    if (!displayOrderRedemptions && (dto.showOnRedemptions ?? true)) {
      const maxRedemptions = await this.prizeConfigRepository
        .createQueryBuilder('pc')
        .select('MAX(pc.displayOrderRedemptions)', 'max')
        .where('pc.category = :category', { category })
        .andWhere('pc.isActive = :isActive', { isActive: true })
        .getRawOne();
      displayOrderRedemptions = (maxRedemptions?.max || 0) + 1;
    }

    // Featured display order - only set if explicitly provided
    const featuredDisplayOrder = dto.featuredDisplayOrder ?? null;

    // Create new tier
    const proEarlyAccessUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const newTier = this.prizeConfigRepository.create({
      prizeTier,
      amount,
      name: dto.name,
      description: dto.description || null,
      imageUrl: coverImageUrl,
      coverImageId: null,
      category,
      grade: dto.grade || null,
      stock: dto.stock ?? 0,
      purchaseOption,
      brand: dto.brand || PrizeBrand.POKEMON,
      displayOrderShop,
      sellerDisplayOrderShop,
      displayOrderRedemptions,
      featuredDisplayOrder,
      showOnRedemptions: dto.showOnRedemptions ?? true,
      showOnShop: dto.showOnShop ?? true,
      isActive: true,
      createdBy: createdBy, // null for admin items, sellerId for seller items
      updatedBy: userId,
      profileFeatured: dto.profileFeatured ?? false,
      isProOnly: dto.isProOnly ?? false,
      proEarlyAccessUntil,
      ebaySearchQuery: dto.ebaySearchQuery?.trim() || null,
      saleType: dto.saleType ?? undefined,
      // Per-item shipping fee. DB column has DEFAULT 5.00 but we forward
      // the admin-supplied value when present so creators can customize.
      shippingCostUsd:
        dto.shippingCostUsd != null
          ? dto.shippingCostUsd.toFixed(2)
          : undefined,
      // In-person pickup flag. When true the checkout/offer flows skip
      // shipping address collection and the cart contributes $0 shipping
      // for this item regardless of `shippingCostUsd`.
      isInPerson: dto.isInPerson ?? false,
    });

    const saved = await this.prizeConfigRepository.save(newTier);
    const savedImages = await this.saveItemImagesForPrizeConfig(
      saved.id,
      normalizedImageUrls,
      coverImageIndex,
    );

    saved.itemImages = savedImages;
    saved.coverImageId =
      savedImages[coverImageIndex]?.id || savedImages[0]?.id || null;
    saved.imageUrl = coverImageUrl;

    this.logger.log(
      `Prize tier ${prizeTier} created by user ${userId}. New ID: ${saved.id}`,
    );

    return this.mapToDto(saved);
  }

  /**
   * Update prize tier (used by both admin and seller endpoints).
   * Implements data hardening: deactivates old tier and creates new one.
   *
   * @param id - ID of the tier to update
   * @param dto - Updated prize tier data
   * @param userId - User ID making the change
   * @param preserveCreatedBy - If true, preserve the original createdBy value (default: true)
   */
  async updatePrizeTier(
    id: string,
    dto: UpdatePrizeTierDto,
    userId: string,
    createdBy?: string,
  ): Promise<PrizeConfigurationDto> {
    // Validate that createdBy is an active seller if provided
    if (createdBy) {
      const seller = await this.userRepository.findOne({
        where: { id: createdBy, isActive: true },
      });

      if (!seller) {
        throw new BadRequestException(
          `User with ID ${createdBy} not found or inactive`,
        );
      }

      if (!seller.isSeller) {
        throw new BadRequestException(
          `User ${seller.username} is not a seller`,
        );
      }
    }

    // Find existing tier
    const existingTier = await this.getPrizeTierById(id);

    // Note: If the tier is inactive, we'll still create a new active version
    // This handles the case where the same item is being updated multiple times

    // Determine purchase option
    const purchaseOption = dto.purchaseOption || existingTier.purchaseOption;

    // Validate and set amount
    let amount: number;
    if (purchaseOption === PrizePurchaseOption.OFFERS_ONLY) {
      // For offers_only, use 1 as default (admin doesn't need to enter price)
      amount = dto.amount && dto.amount > 0 ? dto.amount : 1;
    } else {
      // For buy_only or both, amount is required and must be positive
      if (!dto.amount || dto.amount <= 0) {
        throw new BadRequestException(
          'Prize amount is required and must be positive for buy_only and both purchase options',
        );
      }
      amount = dto.amount;
    }

    // Amount from admin is always in CadeCoins - no conversion needed on update
    // The frontend handles the USD-to-CadeCoins conversion before sending
    const effectiveCreatedBy =
      createdBy !== undefined ? createdBy : existingTier.createdBy;

    const existingItemImages = await this.getItemImagesForPrizeConfig(
      existingTier.id,
    );
    const existingImageUrls =
      existingItemImages.length > 0
        ? existingItemImages.map((img) => img.imageUrl)
        : this.normalizeItemImageUrls(undefined, existingTier.imageUrl);

    let existingCoverIndex = 0;
    if (existingItemImages.length > 0 && existingTier.coverImageId) {
      const coverIndex = existingItemImages.findIndex(
        (img) => img.id === existingTier.coverImageId,
      );
      existingCoverIndex = coverIndex >= 0 ? coverIndex : 0;
    }

    const hasNewImagePayload =
      dto.imageUrls !== undefined || dto.imageUrl !== undefined;

    const normalizedImageUrls = hasNewImagePayload
      ? this.normalizeItemImageUrls(dto.imageUrls, dto.imageUrl)
      : existingImageUrls;

    this.ensureImageLimit(normalizedImageUrls);

    if (normalizedImageUrls.length === 0) {
      throw new BadRequestException(
        'At least one image is required when updating an item',
      );
    }

    const coverImageIndex = this.resolveCoverImageIndex(
      normalizedImageUrls,
      dto.coverImageIndex ?? (hasNewImagePayload ? 0 : existingCoverIndex),
    );
    const coverImageUrl = normalizedImageUrls[coverImageIndex] || null;

    // Data hardening: Set old tier to inactive
    existingTier.isActive = false;
    await this.prizeConfigRepository.save(existingTier);

    // If createdBy is changing and the new creator already has an item with this tier,
    // find the next available tier for them
    let finalTier = dto.prizeTier ?? existingTier.prizeTier;
    const oldCreatedBy = existingTier.createdBy;

    if (effectiveCreatedBy && effectiveCreatedBy !== oldCreatedBy) {
      // Check if this seller already has an item with this tier
      const tierExists = await this.prizeConfigRepository.findOne({
        where: {
          createdBy: effectiveCreatedBy,
          prizeTier: finalTier,
          isActive: true,
        },
      });

      if (tierExists) {
        // Find the next available tier for this seller
        const existingTiers = await this.prizeConfigRepository.find({
          where: {
            createdBy: effectiveCreatedBy,
            isActive: true,
          },
          order: { prizeTier: 'DESC' },
        });

        finalTier = (existingTiers[0]?.prizeTier ?? 0) + 1;
        this.logger.log(
          `Tier ${dto.prizeTier ?? existingTier.prizeTier} already exists for seller ${effectiveCreatedBy}. Assigned tier ${finalTier} instead.`,
        );
      }
    }

    // Create new tier with updated data and new UUID
    const newTier = this.prizeConfigRepository.create({
      prizeTier: finalTier,
      amount,
      name: dto.name,
      description: dto.description || null,
      imageUrl: coverImageUrl,
      coverImageId: null,
      category: (dto.category || existingTier.category) as
        | 'raw'
        | 'slab'
        | 'sealed'
        | 'other',
      grade: dto.grade !== undefined ? dto.grade || null : existingTier.grade,
      stock: dto.stock ?? existingTier.stock,
      purchaseOption: dto.purchaseOption || existingTier.purchaseOption,
      brand: dto.brand || existingTier.brand,
      displayOrderShop: dto.displayOrderShop ?? existingTier.displayOrderShop,
      sellerDisplayOrderShop:
        dto.sellerDisplayOrderShop ??
        existingTier.sellerDisplayOrderShop ??
        (effectiveCreatedBy ? existingTier.displayOrderShop : null),
      displayOrderRedemptions:
        dto.displayOrderRedemptions ?? existingTier.displayOrderRedemptions,
      featuredDisplayOrder:
        dto.featuredDisplayOrder ?? existingTier.featuredDisplayOrder,
      showOnRedemptions:
        dto.showOnRedemptions ?? existingTier.showOnRedemptions,
      showOnShop: dto.showOnShop ?? existingTier.showOnShop,
      isActive: true,
      createdBy: effectiveCreatedBy, // Use new value if provided, otherwise preserve existing
      updatedBy: userId,
      profileFeatured:
        dto.profileFeatured ?? existingTier.profileFeatured ?? false,
      isProOnly: dto.isProOnly ?? existingTier.isProOnly ?? false,
      proEarlyAccessUntil: existingTier.proEarlyAccessUntil,
      ebaySearchQuery:
        dto.ebaySearchQuery !== undefined
          ? dto.ebaySearchQuery?.trim() || null
          : existingTier.ebaySearchQuery,
      ebayMarketLastCalculatedAt: existingTier.ebayMarketLastCalculatedAt,
      // Per-item shipping fee. Preserve previous value when the admin
      // doesn't include it in the patch.
      shippingCostUsd:
        dto.shippingCostUsd != null
          ? dto.shippingCostUsd.toFixed(2)
          : existingTier.shippingCostUsd,
      // Preserve existing in-person flag when the patch omits it.
      isInPerson:
        dto.isInPerson != null
          ? dto.isInPerson
          : (existingTier.isInPerson ?? false),
      // Data-hardening creates a brand-new row on every edit. Fields the
      // edit dialog doesn't surface still need to be carried over verbatim
      // or the item silently changes shape (e.g. an auction item flips back
      // to fixed_price and disappears from the Auctions tab).
      saleType: existingTier.saleType,
      cardValueUsd: existingTier.cardValueUsd,
      stripeProductId: existingTier.stripeProductId,
    });

    const saved = await this.prizeConfigRepository.save(newTier);
    const savedImages = await this.saveItemImagesForPrizeConfig(
      saved.id,
      normalizedImageUrls,
      coverImageIndex,
    );

    saved.itemImages = savedImages;
    saved.coverImageId =
      savedImages[coverImageIndex]?.id || savedImages[0]?.id || null;
    saved.imageUrl = coverImageUrl;

    this.logger.log(
      `Prize tier ${finalTier} updated by user ${userId}. Old ID: ${id}, New ID: ${saved.id}`,
    );

    // Data hardening creates a brand-new row for every update, so the
    // watchlist + view records that point at the old id need to be moved
    // to the new id, otherwise users who watched the item would silently
    // lose their watch (and notifications) every time the seller edits it.
    try {
      await this.prizeConfigRepository.manager.query(
        `UPDATE prize_item_watchers SET item_id = $1 WHERE item_id = $2`,
        [saved.id, id],
      );
      await this.prizeConfigRepository.manager.query(
        `UPDATE prize_item_views SET item_id = $1 WHERE item_id = $2`,
        [saved.id, id],
      );
      // Re-point the auction (if any) at the new prize_configurations row.
      // Auction.prize_configuration_id has a UNIQUE constraint and a
      // CASCADE FK back to prize_configurations, so the old (now inactive)
      // tier row would orphan the auction otherwise — and the new active
      // tier would have no `auction` relation, making the item silently
      // disappear from the Auctions tab.
      await this.prizeConfigRepository.manager.query(
        `UPDATE auctions SET prize_configuration_id = $1 WHERE prize_configuration_id = $2`,
        [saved.id, id],
      );
      // Re-point eBay sold listings at the new prize_configurations row.
      // Without this, editing an item would make all fetched eBay market
      // data disappear (sold listings would still exist but point to the
      // old inactive item_id).
      await this.prizeConfigRepository.manager.query(
        `UPDATE prize_item_ebay_sold_listings SET item_id = $1 WHERE item_id = $2`,
        [saved.id, id],
      );
      // Re-point eBay sync state at the new prize_configurations row.
      // Without this, the system would lose track of when it last fetched
      // eBay data and would unnecessarily re-fetch or fail to sync.
      await this.prizeConfigRepository.manager.query(
        `UPDATE prize_item_ebay_sync_state SET item_id = $1 WHERE item_id = $2`,
        [saved.id, id],
      );
      // Mirror the cached counters onto the new row.
      saved.watcherCount = existingTier.watcherCount ?? 0;
      saved.viewCount = existingTier.viewCount ?? 0;
      await this.prizeConfigRepository.save(saved);
    } catch (err) {
      this.logger.warn(
        `Failed to migrate watchers/views/auction/ebay from ${id} -> ${saved.id}: ${(err as Error).message}`,
      );
    }

    // If the price actually changed, notify everyone who was watching it.
    if (Number(existingTier.amount) !== Number(saved.amount)) {
      // Make sure the creator relation is populated so the notification can
      // build a correct shop URL.
      let itemForNotify: PrizeConfiguration = saved;
      if (saved.createdBy && !saved.creator) {
        const withCreator = await this.prizeConfigRepository.findOne({
          where: { id: saved.id },
          relations: ['creator'],
        });
        if (withCreator) itemForNotify = withCreator;
      }
      this.engagementService
        .notifyWatchersOfPriceChange(
          itemForNotify,
          Number(existingTier.amount),
          Number(saved.amount),
        )
        .catch((err) =>
          this.logger.warn(
            `Failed to notify watchers of price change for ${saved.id}: ${(err as Error).message}`,
          ),
        );
    }

    return this.mapToDto(saved);
  }

  /**
   * Delete (soft delete) a prize tier (admin only).
   *
   * @param id - ID of the tier to delete
   */
  async deletePrizeTier(id: string): Promise<void> {
    const tier = await this.getPrizeTierById(id);

    if (!tier.isActive) {
      throw new BadRequestException('Prize tier is already inactive');
    }

    // Soft delete: set to inactive
    tier.isActive = false;
    await this.prizeConfigRepository.save(tier);

    this.logger.log(`Prize tier ${tier.prizeTier} (ID: ${id}) deactivated`);
  }

  /**
   * Bulk update display orders for prizes (admin only).
   * Updates page-specific display orders and/or featuredDisplayOrder for multiple prizes.
   *
   * @param updates - Array of prize updates with id and all display orders
   * @param userId - Admin user performing the update
   * @returns Updated prize configurations
   */
  async bulkUpdateDisplayOrder(
    updates: PrizeDisplayOrderUpdateDto[],
    userId: string,
  ): Promise<PrizeConfigurationDto[]> {
    const updatedPrizes: PrizeConfiguration[] = [];

    for (const update of updates) {
      const prize = await this.getPrizeTierById(update.id);

      if (!prize.isActive) {
        throw new BadRequestException(
          `Cannot update inactive prize: ${prize.name}`,
        );
      }

      // Update all page-specific display orders
      prize.displayOrderShop = update.displayOrderShop;
      prize.displayOrderRedemptions = update.displayOrderRedemptions;
      prize.featuredDisplayOrder = update.featuredDisplayOrder;

      // Update sorting preferences if provided
      if (update.sortByPurchaseOptionShop !== undefined) {
        prize.sortByPurchaseOptionShop = update.sortByPurchaseOptionShop;
      }
      if (update.sortByPurchaseOptionRedemptions !== undefined) {
        prize.sortByPurchaseOptionRedemptions =
          update.sortByPurchaseOptionRedemptions;
      }

      prize.updatedBy = userId;

      const saved = await this.prizeConfigRepository.save(prize);
      updatedPrizes.push(saved);
    }

    this.logger.log(
      `Bulk updated display order for ${updates.length} prizes by user ${userId}`,
    );

    return updatedPrizes.map((p) => this.mapToDto(p));
  }

  /**
   * Get all prize configurations (admin only, for history/audit).
   * Returns both active and inactive tiers.
   */
  async getAllConfigurations(): Promise<PrizeConfigurationDto[]> {
    const configs = await this.prizeConfigRepository.find({
      relations: ['itemImages'],
      order: { prizeTier: 'ASC', createdAt: 'DESC' },
    });
    return configs.map((c) => this.mapToDto(c));
  }

  /**
   * Helper: Convert prize tiers to PrizeItemDto array.
   * Shared logic to avoid duplication across methods.
   */
  private mapTiersToPrizeItems(tiers: PrizeConfiguration[]): PrizeItemDto[] {
    return tiers.map((tier) => ({
      prizeTier: tier.prizeTier,
      amount: Number(tier.amount),
      name: tier.name,
      description: tier.description || '',
      imageUrl: tier.imageUrl,
    }));
  }

  /**
   * Helper: Find the highest achieved prize for a given lifetime coin amount.
   * Returns null if no prizes achieved.
   */
  private findCurrentAchievement(
    prizes: PrizeItemDto[],
    lifetimeCoins: number,
  ): PrizeItemDto | null {
    const achievedPrizes = prizes.filter((p) => lifetimeCoins >= p.amount);
    return achievedPrizes.length > 0
      ? achievedPrizes[achievedPrizes.length - 1]
      : null;
  }

  /**
   * Calculate user's prize progress dynamically based on active configuration.
   *
   * @param lifetimeCoins - User's total lifetime coins earned
   * @returns Prize progress with current status and next goals
   */
  async calculatePrizeProgress(
    lifetimeCoins: number,
  ): Promise<PrizeProgressDto> {
    // Validate input
    if (!Number.isFinite(lifetimeCoins) || lifetimeCoins < 0) {
      lifetimeCoins = 0;
    }

    const tiers = await this.getActivePrizeTiers();
    const prizes = this.mapTiersToPrizeItems(tiers);

    // Find achieved prizes
    const nextPrize = prizes.find((p) => lifetimeCoins < p.amount);

    // Calculate progress percentage using equal segments
    const progressPercent = this.calculateProgressPercentage(
      lifetimeCoins,
      prizes,
    );

    // Build allPrizes array with achievement status
    const allPrizes = prizes.map((prize) => ({
      ...prize,
      achieved: lifetimeCoins >= prize.amount,
    }));

    return {
      lifetimeCoinsEarned: lifetimeCoins,
      nextPrize: nextPrize?.amount || null,
      nextPrizeName: nextPrize?.name || null,
      progressPercent,
      allPrizes,
    };
  }

  /**
   * Calculate progress percentage dynamically for any number of prizes.
   * Divides the progress bar into equal segments.
   */
  private calculateProgressPercentage(
    lifetimeCoins: number,
    prizes: PrizeItemDto[],
  ): number {
    const prizeCount = prizes.length;
    const segmentPercent = 100 / prizeCount;

    // If user has achieved all prizes
    if (lifetimeCoins >= prizes[prizeCount - 1].amount) {
      return 100;
    }

    // Find which segment the user is currently in
    for (let i = 0; i < prizeCount; i++) {
      const currentPrize = prizes[i];
      const previousAmount = i === 0 ? 0 : prizes[i - 1].amount;

      // User is in this segment
      if (lifetimeCoins < currentPrize.amount) {
        const coinsInSegment = lifetimeCoins - previousAmount;
        const segmentRange = currentPrize.amount - previousAmount;
        const segmentProgress = coinsInSegment / segmentRange;

        // Calculate total progress: completed segments + current segment progress
        const completedSegments = i;
        const totalProgress =
          completedSegments * segmentPercent + segmentProgress * segmentPercent;

        return Math.round(totalProgress * 100) / 100; // Round to 2 decimals
      }
    }

    return 0; // Fallback
  }

  /**
   * Get prize information for gamification (badge level, title).
   * Returns user's current achievement status.
   */
  async getPrizeInfo(lifetimeCoins: number): Promise<{
    title: string;
    badgeLevel: string;
    prizeProgress: PrizeProgressDto;
  }> {
    const tiers = await this.getActivePrizeTiers();
    const prizes = this.mapTiersToPrizeItems(tiers);

    // Find the highest achieved prize using helper
    const currentPrize = this.findCurrentAchievement(prizes, lifetimeCoins);

    // Get the index of the current prize
    const prizeIndex = currentPrize
      ? prizes.findIndex((p) => p.amount === currentPrize.amount)
      : -1;

    // Calculate progress
    const prizeProgress = await this.calculatePrizeProgress(lifetimeCoins);

    return {
      title: currentPrize?.name || 'Badgeless Wonder',
      badgeLevel: prizeIndex >= 0 ? prizeIndex.toString() : 'none',
      prizeProgress,
    };
  }

  /**
   * Record a prize redemption with shipping address.
   *
   * @param userId - User ID redeeming the prize
   * @param dto - Redemption details with shipping address
   */
  async redeemPrize(
    userId: string,
    dto: SubmitPrizeRedemptionDto,
  ): Promise<UserRedemptionResponseDto> {
    // Verify prize tier exists
    const prizeConfig = await this.getPrizeTierById(dto.prizeConfigId);

    // Check if already redeemed by tier number (handles UUID changes)
    const existingByTier = await this.prizeRedemptionRepository.findOne({
      where: {
        userId,
        prizeTier: dto.prizeLevel,
        fulfilled: true,
      },
    });

    if (existingByTier) {
      throw new ConflictException(
        `Prize tier ${dto.prizeLevel} has already been redeemed by this user`,
      );
    }

    // Update user's shipping address
    await this.userRepository.update(userId, {
      address: dto.shippingAddress.addressLine1,
      address2: dto.shippingAddress.addressLine2 || null,
      city: dto.shippingAddress.city,
      state: dto.shippingAddress.state,
      zipCode: dto.shippingAddress.zipCode,
      country: dto.shippingAddress.country,
    });

    // Create redemption record
    const redemption = this.prizeRedemptionRepository.create({
      userId,
      prizeConfigurationId: dto.prizeConfigId,
      dateRedeemed: new Date(),
      prizeTier: dto.prizeLevel,
      prizeCategory: dto.prizeCategory,
      shippingStatus: ShippingStatus.OPEN,
      fulfilled: false,
    });

    const saved = await this.prizeRedemptionRepository.save(redemption);
    this.logger.log(`User ${userId} redeemed prize tier ${dto.prizeLevel}`);

    return this.mapToUserRedemptionDto(saved, prizeConfig);
  }

  /**
   * Get redemption history for a user (without address).
   */
  async getUserRedemptions(
    userId: string,
  ): Promise<UserRedemptionResponseDto[]> {
    const redemptions = await this.prizeRedemptionRepository.find({
      where: { userId },
      relations: ['prizeConfiguration'],
      order: { dateRedeemed: 'DESC' },
    });

    return redemptions.map((r) =>
      this.mapToUserRedemptionDto(r, r.prizeConfiguration),
    );
  }

  /**
   * Get all redemptions for admin (with user details including address).
   */
  async getAdminRedemptions(filterDto: {
    range?: string;
    status?: string;
  }): Promise<{ data: AdminRedemptionResponseDto[]; total: number }> {
    const range: [number, number] = filterDto.range
      ? (JSON.parse(filterDto.range) as [number, number])
      : [0, 20];

    const query = this.prizeRedemptionRepository
      .createQueryBuilder('redemption')
      .leftJoinAndSelect('redemption.user', 'user')
      .leftJoinAndSelect('redemption.prizeConfiguration', 'prizeConfig')
      .leftJoinAndSelect('redemption.prizeOrder', 'prizeOrder');

    if (filterDto.status) {
      query.andWhere('redemption.shippingStatus = :status', {
        status: filterDto.status,
      });
    }

    query.orderBy('redemption.dateRedeemed', 'DESC');

    const totalCount = await query.getCount();
    const [offset, limit] = range;

    // Calculate total pages
    const total = Math.ceil(totalCount / limit);

    query.skip(offset).take(limit);

    const redemptions = await query.getMany();
    const data = redemptions.map((r) => this.mapToAdminRedemptionDto(r));

    return { data, total };
  }

  /**
   * Get a single redemption for admin with full details.
   */
  async getAdminRedemptionById(
    id: string,
  ): Promise<AdminRedemptionResponseDto> {
    const redemption = await this.prizeRedemptionRepository.findOne({
      where: { id },
      relations: ['user', 'prizeConfiguration', 'prizeOrder'],
    });

    if (!redemption) {
      throw new NotFoundException(`Redemption with ID ${id} not found`);
    }

    return this.mapToAdminRedemptionDto(redemption);
  }

  /**
   * Update redemption status and tracking information (admin only).
   */
  async updateRedemptionStatus(
    id: string,
    dto: UpdateRedemptionStatusDto,
  ): Promise<AdminRedemptionResponseDto> {
    const redemption = await this.prizeRedemptionRepository.findOne({
      where: { id },
      relations: ['user', 'prizeConfiguration'],
    });

    if (!redemption) {
      throw new NotFoundException(`Redemption with ID ${id} not found`);
    }

    // Update fields
    redemption.shippingStatus = dto.shippingStatus;

    if (dto.trackingNumber) {
      redemption.trackingNumber = dto.trackingNumber;
    }

    if (dto.shippingCarrier) {
      redemption.shippingCarrier = dto.shippingCarrier;
    }

    // Auto-set fulfilled when marked as complete
    if (dto.shippingStatus === ShippingStatus.COMPLETE) {
      redemption.fulfilled = true;
    }

    const saved = await this.prizeRedemptionRepository.save(redemption);
    this.logger.log(
      `Redemption ${id} updated to status: ${dto.shippingStatus}`,
    );

    if (dto.shippingStatus === ShippingStatus.SHIPPED) {
      try {
        await this.emailsService.sendEmailSMTP(
          {
            toAddress: [redemption.user.email],
            subject: `Your ${redemption.prizeConfiguration.name} has shipped! 📦`,
            params: {
              fullName: redemption.user.name || redemption.user.username,
              prizeName: redemption.prizeConfiguration.name,
              trackingNumber: dto.trackingNumber,
              shippingCarrier: dto.shippingCarrier,
            },
          },
          'prize_shipped',
        );
        this.logger.log(
          `Shipped notification email sent to ${redemption.user.email} for redemption ${id}`,
        );
      } catch (emailError) {
        this.logger.error(
          `Failed to send shipped notification email for redemption ${id}:`,
          emailError,
        );
      }
    }

    return this.mapToAdminRedemptionDto(saved);
  }

  /**
   * Map prize configuration to summary DTO (shared helper)
   */
  private mapPrizeConfigToSummary(prizeConfig: PrizeConfiguration) {
    return {
      id: prizeConfig.id,
      prizeTier: prizeConfig.prizeTier,
      name: prizeConfig.name,
      description: prizeConfig.description,
      imageUrl: prizeConfig.imageUrl,
      amount: Number(prizeConfig.amount),
    };
  }

  /**
   * Map redemption base fields (shared helper)
   */
  private mapRedemptionBaseFields(redemption: PrizeRedemption) {
    return {
      id: redemption.id,
      userId: redemption.userId,
      prizeConfigurationId: redemption.prizeConfigurationId,
      prizeTier: redemption.prizeTier,
      prizeCategory: redemption.prizeCategory,
      dateRedeemed: redemption.dateRedeemed,
      shippingStatus: redemption.shippingStatus as ShippingStatus,
      trackingNumber: redemption.trackingNumber,
      shippingCarrier: redemption.shippingCarrier,
      fulfilled: redemption.fulfilled,
      createdAt: redemption.createdAt,
      updatedAt: redemption.updatedAt,
    };
  }

  /**
   * Map redemption to user response (no address).
   */
  private mapToUserRedemptionDto(
    redemption: PrizeRedemption,
    prizeConfig?: PrizeConfiguration,
  ): UserRedemptionResponseDto {
    return {
      ...this.mapRedemptionBaseFields(redemption),
      prizeConfiguration: prizeConfig
        ? this.mapPrizeConfigToSummary(prizeConfig)
        : undefined,
    };
  }

  /**
   * Map user entity to user summary with address (shared helper).
   */
  private mapUserWithAddress(user: User) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      address: user.address,
      address2: user.address2,
      city: user.city,
      state: user.state,
      zipCode: user.zipCode,
      country: user.country,
    };
  }

  /**
   * Map redemption to admin response (with address).
   */
  private mapToAdminRedemptionDto(
    redemption: PrizeRedemption & {
      user?: User;
      prizeConfiguration?: PrizeConfiguration;
      prizeOrder?: PrizeOrder | null;
    },
  ): AdminRedemptionResponseDto {
    return {
      ...this.mapRedemptionBaseFields(redemption),
      user: redemption.user
        ? this.mapUserWithAddress(redemption.user)
        : undefined,
      prizeConfiguration: redemption.prizeConfiguration
        ? this.mapPrizeConfigToSummary(redemption.prizeConfiguration)
        : undefined,
      paymentMethod: redemption.prizeOrder?.paymentMethod || null,
      coinsDeducted: redemption.prizeOrder?.coinsDeducted || null,
      usdCharged: redemption.prizeOrder
        ? redemption.prizeOrder.usdCharged.toString()
        : null,
    };
  }

  /**
   * Create a prize order with combined payment (coins + USD)
   * 50 Cade coins = $1
   * @param userId - User creating the order
   * @param dto - Order details
   */
  async createPrizeOrder(
    userId: string,
    dto: CreatePrizeOrderDto,
  ): Promise<any> {
    // Validate prize exists and is active
    const prize = await this.getPrizeTierById(dto.prizeConfigId);
    if (!prize.isActive) {
      throw new BadRequestException('This prize is no longer available');
    }
    if (prize.saleType === PrizeSaleType.AUCTION) {
      throw new BadRequestException(
        'Auction items can only be acquired by winning the auction. Promo codes do not apply to auction purchases.',
      );
    }
    if (prize.purchaseOption === PrizePurchaseOption.OFFERS_ONLY) {
      throw new BadRequestException(
        'This prize is offer-only and cannot be purchased directly',
      );
    }

    // Block non-Pro users from purchasing Pro-only or early-access items
    const buyer = await this.userRepository.findOne({ where: { id: userId } });
    if (!buyer?.isProSubscriber) {
      const now = new Date();
      if (prize.isProOnly) {
        throw new ForbiddenException(
          'This item is exclusive to CardCade Pro members.',
        );
      }
      if (
        prize.proEarlyAccessUntil &&
        new Date(prize.proEarlyAccessUntil as unknown as string) > now
      ) {
        throw new ForbiddenException(
          'This item is in the 24-hour early access window for CardCade Pro members.',
        );
      }
    }

    const isSellerOwnedItem = await this.isSellerOwnedItem(prize);
    if (
      isSellerOwnedItem &&
      dto.paymentMethod !== 'usd' &&
      dto.paymentMethod !== 'crypto'
    ) {
      throw new BadRequestException(
        'Seller shop items are USD-only. CadeCoins are not accepted for this item.',
      );
    }

    const SHIPPING_FEE =
      prize.shippingCostUsd != null ? Number(prize.shippingCostUsd) : 5; // Per-item shipping fee (default $5; 0 = Free Shipping)

    // Validate payment method matches amounts
    if (dto.paymentMethod === 'coins' && dto.usdAmount !== 0) {
      throw new BadRequestException(
        'For coins-only payment, USD amount must be 0',
      );
    }
    if (dto.paymentMethod === 'usd' && dto.coinsAmount !== 0) {
      throw new BadRequestException(
        'For USD-only payment, coins amount must be 0',
      );
    }
    if (
      dto.paymentMethod === 'combined' &&
      (dto.coinsAmount === 0 || dto.usdAmount === 0)
    ) {
      throw new BadRequestException(
        'For combined payment, both amounts must be > 0',
      );
    }
    if (dto.paymentMethod === 'crypto') {
      if (dto.coinsAmount !== 0) {
        throw new BadRequestException(
          'For crypto payment, coins amount must be 0',
        );
      }
      if (dto.usdAmount <= 0) {
        throw new BadRequestException(
          'For crypto payment, USD amount must be > 0',
        );
      }
      if (prize.createdBy) {
        // Seller-owned item: validate the seller's own crypto config.
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });
        if (!seller?.cryptoPaymentsEnabled) {
          throw new BadRequestException(
            'Seller does not accept crypto payments',
          );
        }
        if (!seller.solanaWallet) {
          throw new BadRequestException(
            'Seller has not configured a Solana wallet',
          );
        }
      } else {
        // CardCade-owned item (no creator): validate platform shop_settings.
        // The crypto-order service later resolves the destination wallet
        // from this same row via `resolveSellerWallet`.
        const cardcadeSettings = await this.shopSettingsRepository.findOne({
          where: { shopKey: 'cardcade' },
        });
        if (
          !cardcadeSettings?.cryptoPaymentsEnabled ||
          !cardcadeSettings.cryptoWalletAddress
        ) {
          throw new BadRequestException(
            'CardCade is not currently accepting crypto payments',
          );
        }
      }
    }

    // Verify total price calculation (50 coins = $1)
    const coinsAsUSD = dto.coinsAmount / 50;
    const expectedTotal = coinsAsUSD + dto.usdAmount;
    if (Math.abs(expectedTotal - dto.totalPrice) > 0.01) {
      throw new BadRequestException('Price calculation mismatch');
    }

    // Get user and check wallet balance for coins
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['wallet'],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.paymentMethod === 'coins' || dto.paymentMethod === 'combined') {
      const cadeCoins = user.wallet?.cadeCoins || 0;
      if (cadeCoins < dto.coinsAmount) {
        throw new BadRequestException(
          `Insufficient CadeCoins. You have ${cadeCoins}, but need ${dto.coinsAmount}`,
        );
      }
    }

    // Create the order (frontend amounts already include shipping)
    const order = this.prizeOrderRepository.create({
      userId,
      prizeConfigurationId: dto.prizeConfigId,
      shippingAddress: dto.shippingAddress,
      paymentMethod: dto.paymentMethod,
      coinsDeducted: dto.coinsAmount,
      usdCharged: parseFloat(dto.usdAmount.toString()),
      totalPrice: parseFloat(dto.totalPrice.toString()),
      status: 'buy_attempted', // User submitted form with shipping info
    });

    const savedOrder = await this.prizeOrderRepository.save(order);

    // Handle payments
    let stripeSessionUrl = null;

    if (dto.paymentMethod === 'coins') {
      // Instant payment with coins - deduct immediately
      try {
        await this.walletService.deductForBet(
          userId,
          dto.coinsAmount,
          CurrencyType.CADE_COINS,
          `Prize purchase: ${prize.name}`,
        );

        // Mark order as paid
        savedOrder.status = 'paid';
        await this.prizeOrderRepository.save(savedOrder);

        await this.userRepository.update(userId, {
          address: savedOrder.shippingAddress.addressLine1,
          address2: savedOrder.shippingAddress.addressLine2 || null,
          city: savedOrder.shippingAddress.city,
          state: savedOrder.shippingAddress.state,
          zipCode: savedOrder.shippingAddress.zipCode,
          country: savedOrder.shippingAddress.country,
        });
        await this.ensureRedemptionForOrder(savedOrder, prize);

        await this.awardCadeCoinTransactionRewards(
          savedOrder,
          prize,
          Math.round(Number(savedOrder.totalPrice || 0) * 100),
          'coins_checkout',
        );

        // Decrement stock
        this.logger.log(
          `About to decrement stock for prize ${dto.prizeConfigId}`,
        );
        try {
          const prizeToUpdate = await this.prizeConfigRepository.findOne({
            where: { id: dto.prizeConfigId },
          });
          if (prizeToUpdate) {
            prizeToUpdate.stock = Math.max(0, prizeToUpdate.stock - 1);
            await this.prizeConfigRepository.save(prizeToUpdate);
            this.logger.log(
              `Stock decremented for prize ${dto.prizeConfigId}. New stock: ${prizeToUpdate.stock}`,
            );
            if (prizeToUpdate.stock === 0) {
              this.engagementService
                .notifyWatchersOfSoldOut(prizeToUpdate)
                .catch((err) =>
                  this.logger.warn(
                    `Failed to notify watchers of sold out for ${prizeToUpdate.id}: ${err?.message ?? err}`,
                  ),
                );
            }
          } else {
            this.logger.error(
              `Prize ${dto.prizeConfigId} not found for stock decrement`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to decrement stock for prize ${dto.prizeConfigId}: ${error}`,
          );
        }

        this.logger.log(
          `Prize order ${savedOrder.id} paid with coins for user ${userId}`,
        );

        // Send notification emails
        try {
          const buyer = await this.userRepository.findOne({
            where: { id: userId },
          });
          if (buyer) {
            await this.sendSellerShopPurchaseNotification(
              savedOrder,
              prize,
              buyer,
            );
            await this.sendBuyerShopPurchaseNotification(
              savedOrder,
              prize,
              buyer,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to send notification emails for order ${savedOrder.id}:`,
            error,
          );
        }
      } catch (error) {
        // Revert order if coin deduction fails
        await this.prizeOrderRepository.remove(savedOrder);
        throw error;
      }
    } else if (
      dto.paymentMethod === 'usd' ||
      dto.paymentMethod === 'combined'
    ) {
      // Create Stripe checkout session for USD portion
      try {
        // Lock in the buyer's chosen Stripe payment method. Required
        // for USD/combined because card and ACH have different fee
        // tiers (3% vs 0.8%) — falling back silently would let a
        // tampered client pay the higher fee at the lower rate.
        const chosenStripeMethod: 'card' | 'us_bank_account' =
          dto.stripePaymentMethod === 'us_bank_account'
            ? 'us_bank_account'
            : dto.stripePaymentMethod === 'card'
              ? 'card'
              : (() => {
                  throw new BadRequestException(
                    'stripePaymentMethod ("card" or "us_bank_account") is required for USD or combined payments.',
                  );
                })();

        const subtotalCents = Math.round(dto.usdAmount * 100);

        // Load seller to check for Stripe Connect account and application fee
        const seller = prize.createdBy
          ? await this.userRepository.findOne({
              where: { id: prize.createdBy },
              relations: ['wallet'],
            })
          : null;

        // Buyer fee applies to item subtotal only (shipping excluded).
        // Rate depends on the chosen Stripe payment method.
        const shippingCents = Math.round(SHIPPING_FEE * 100);
        const buyerFeePercent =
          getBuyerFeePercentForStripeMethod(chosenStripeMethod);
        const buyerFeeCents = calculateBuyerItemFeeCents(
          subtotalCents,
          shippingCents,
          buyerFeePercent,
        );
        const totalChargeCents = subtotalCents + buyerFeeCents;

        // Validate and apply discount code if provided
        let discountValidation: DiscountValidationResult | undefined;
        let stripeCouponId: string | undefined;
        let discountCents = 0;
        if (dto.discountCode) {
          discountValidation = await this.promoCodeService.validateForCart(
            dto.discountCode,
            userId,
          );
          if (!discountValidation.valid) {
            await this.prizeOrderRepository.remove(savedOrder);
            throw new BadRequestException(discountValidation.message);
          }
          discountCents = this.promoCodeService.calculateDiscountCents(
            discountValidation,
            subtotalCents,
            subtotalCents, // single item = cheapest item
          );
          if (discountCents > 0) {
            const couponParams: Stripe.CouponCreateParams = {
              duration: 'once',
              name: `Discount ${discountValidation.code}`,
            };
            if (
              discountValidation.discountType === 'percent' &&
              discountValidation.scope !== 'cheapest_item'
            ) {
              couponParams.percent_off = discountValidation.discountPercent;
            } else {
              couponParams.amount_off = discountCents;
              couponParams.currency = 'usd';
            }
            const stripeCoupon = await this.stripe.coupons.create(couponParams);
            stripeCouponId = stripeCoupon.id;
          }
        }

        const sessionParams = {
          // Restrict to the single payment method the buyer agreed
          // to. Stripe will then refuse anything else server-side,
          // so a tampered client can't sneak a card payment through
          // at the cheaper ACH fee tier (or vice versa).
          payment_method_types: [
            chosenStripeMethod,
          ] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `${prize.name} Prize Purchase`,
                  description:
                    dto.paymentMethod === 'combined'
                      ? `${dto.coinsAmount} CadeCoins + $${dto.usdAmount.toFixed(2)} USD + $${(buyerFeeCents / 100).toFixed(2)} service fee`
                      : `$${dto.usdAmount.toFixed(2)} USD + $${(buyerFeeCents / 100).toFixed(2)} service fee`,
                },
                unit_amount: totalChargeCents,
              },
              quantity: 1,
            },
          ],
          mode: 'payment' as const,
          customer_email: user.email,
          success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/purchase-success?orderId=${savedOrder.id}`,
          cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/shop?status=cancel&orderId=${savedOrder.id}`,
          metadata: {
            orderId: savedOrder.id,
            userId,
            prizeId: dto.prizeConfigId,
            paymentMethod: dto.paymentMethod,
            coinsAmount: dto.coinsAmount.toString(),
            transactionSubtotalCents: subtotalCents.toString(),
            buyerFeeCents: buyerFeeCents.toString(),
            ...(discountValidation?.discountCodeId && {
              discountCodeId: discountValidation.discountCodeId,
              discountCents: String(discountCents),
            }),
          },
        };

        if (stripeCouponId) {
          (sessionParams as any).discounts = [{ coupon: stripeCouponId }];
        }

        if (seller?.stripeAccountId) {
          const sellerLifetimeCadeCoins = Number(
            seller.wallet?.lifetimeCoinsEarned || 0,
          );
          const sellerFeePercent = getEffectiveSellerFeePercent({
            lifetimeCadeCoins: sellerLifetimeCadeCoins,
            adminFeeOverridePercent:
              seller.adminFeeOverridePercent !== null &&
              seller.adminFeeOverridePercent !== undefined
                ? Number(seller.adminFeeOverridePercent)
                : null,
          });
          const sellerFeeAmount = calculateSellerFeeCents(
            subtotalCents,
            sellerFeePercent,
          );
          const application_fee_amount = sellerFeeAmount + buyerFeeCents;
          const transfer_data = { destination: seller.stripeAccountId };

          (sessionParams as any).payment_intent_data = {
            application_fee_amount,
            transfer_data,
          };
        }

        const session =
          await this.stripe.checkout.sessions.create(sessionParams);

        // Save Stripe session ID and update totals to include buyer fee
        savedOrder.stripeSessionId = session.id;
        savedOrder.stripePaymentMethod = chosenStripeMethod;
        const buyerFeeUsd = buyerFeeCents / 100;
        savedOrder.usdCharged = parseFloat(
          (dto.usdAmount + buyerFeeUsd).toString(),
        );
        savedOrder.totalPrice = parseFloat(
          (dto.totalPrice + buyerFeeUsd).toString(),
        );
        await this.prizeOrderRepository.save(savedOrder);

        stripeSessionUrl = session.url;

        this.logger.log(
          `Stripe checkout session created for order ${savedOrder.id}. Session ID: ${session.id}`,
        );
      } catch (error) {
        // Revert order if Stripe fails
        await this.prizeOrderRepository.remove(savedOrder);
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown Stripe error';
        throw new BadRequestException(
          `Failed to create checkout session: ${errorMessage}`,
        );
      }
    } else if (dto.paymentMethod === 'crypto') {
      // Order created in 'buy_attempted' status. Client will:
      //   POST /crypto/quote { orderId } → buildTx → wallet sign+send → POST /crypto/confirm
      // No Stripe session, no coin deduction. Buyer fee is added on-chain.
      this.logger.log(
        `Crypto prize order ${savedOrder.id} created for user ${userId}; awaiting on-chain payment`,
      );
    }

    return {
      order: this.mapOrderToDto(savedOrder),
      stripeSessionUrl,
    };
  }

  /**
   * Get order success details - authenticated version.
   * Validates user owns the order.
   */
  async getOrderSuccessDetails(orderId: string, userId: string) {
    const order = await this.prizeOrderRepository.findOne({
      where: { id: orderId, userId },
      relations: ['prizeConfiguration', 'prizeConfiguration.creator'],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.formatOrderSuccessDetails(order);
  }

  /**
   * Get order success details - public version for Stripe redirects.
   * Does not validate ownership since Stripe redirects unauthenticated users.
   */
  async getOrderSuccessDetailsPublic(orderId: string) {
    const order = await this.prizeOrderRepository.findOne({
      where: { id: orderId },
      relations: ['prizeConfiguration', 'prizeConfiguration.creator'],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.formatOrderSuccessDetails(order);
  }

  /**
   * Format order details for success page display.
   */
  private formatOrderSuccessDetails(order: PrizeOrder) {
    const prize = order.prizeConfiguration;
    const seller = prize?.creator;

    return {
      orderId: order.id,
      status: order.status,
      itemName: prize?.name || 'Unknown Item',
      itemImage: prize?.imageUrl || null,
      itemCategory: prize?.category || null,
      itemBrand: prize?.brand || null,
      pricePaid: parseFloat(order.totalPrice.toString()),
      usdCharged: parseFloat(order.usdCharged.toString()),
      coinsDeducted: order.coinsDeducted,
      paymentMethod: order.paymentMethod,
      seller: seller
        ? {
            username: seller.username,
            name: seller.name || seller.username,
          }
        : null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  /**
   * Handle Stripe checkout success and deduct coins if combined payment.
   *
   * `paymentStatus` controls the terminal order state:
   *   - `'succeeded'` (default, card flow): mark the order `paid` and
   *     send the standard buyer/seller purchase emails.
   *   - `'processing'` (ACH / us_bank_account): the buyer has authorised
   *     the debit but Stripe is still settling the funds (3-5 business
   *     days). We still reserve stock, create the redemption and award
   *     reward coins so the buyer is "as good as paid" from our side,
   *     but we mark the order `payment_processing` and send a seller
   *     email that is **painfully clear** about NOT shipping until
   *     the funds clear. A later `payment_intent.succeeded` webhook
   *     flips the order to `paid`; `payment_intent.payment_failed`
   *     reverts everything via `handleAchPaymentFailed`.
   */
  async handlePaymentSuccess(
    orderId: string,
    transactionSubtotalCents?: number,
    discountCodeId?: string,
    discountCentsStr?: string,
    stripeSessionId?: string,
    paymentStatus: 'succeeded' | 'processing' = 'succeeded',
  ): Promise<PrizeOrderResponseDto> {
    const order = await this.getPrizeOrderById(orderId);

    // Record discount code redemption if one was used.
    // This runs BEFORE the paid-check so that webhooks arriving
    // after the client-side confirm still record the redemption.
    if (discountCodeId) {
      try {
        const dc = parseInt(discountCentsStr || '0', 10);
        await this.promoCodeService.recordRedemption(
          discountCodeId,
          order.userId,
          dc,
          stripeSessionId,
        );
      } catch (err) {
        this.logger.error(
          `Failed to record discount redemption for order ${orderId}: ${err}`,
        );
      }
    }

    // Idempotency: if we've already finalised this order (either fully
    // paid or already reserved while ACH settles) skip side-effects.
    if (order.status === 'paid' || order.status === 'payment_processing') {
      return this.mapOrderToDto(order);
    }

    const prize = await this.getPrizeTierById(order.prizeConfigurationId);

    // Deduct coins for combined payment
    if (order.paymentMethod === 'combined' && order.coinsDeducted > 0) {
      try {
        await this.walletService.deductForBet(
          order.userId,
          order.coinsDeducted,
          CurrencyType.CADE_COINS,
          `Prize purchase: ${prize.name}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to deduct coins for order ${orderId}: ${error}`,
        );
        // Don't fail the order, just log the error
        // Admin will need to manually correct this
      }
    }

    // Mark order as paid (card) or payment_processing (ACH still settling)
    order.status =
      paymentStatus === 'processing' ? 'payment_processing' : 'paid';
    const updated = await this.prizeOrderRepository.save(order);

    // Update user shipping address and create redemption
    await this.userRepository.update(order.userId, {
      address: order.shippingAddress.addressLine1,
      address2: order.shippingAddress.addressLine2 || null,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state,
      zipCode: order.shippingAddress.zipCode,
      country: order.shippingAddress.country,
    });
    await this.ensureRedemptionForOrder(updated, prize);

    const subtotalCents =
      transactionSubtotalCents !== undefined
        ? transactionSubtotalCents
        : Math.round(Number(updated.totalPrice || 0) * 100);
    await this.awardCadeCoinTransactionRewards(
      updated,
      prize,
      subtotalCents,
      'stripe_checkout',
    );

    // Decrement stock
    try {
      const prizeToUpdate = await this.prizeConfigRepository.findOne({
        where: { id: order.prizeConfigurationId },
      });
      if (prizeToUpdate) {
        prizeToUpdate.stock = Math.max(0, prizeToUpdate.stock - 1);
        await this.prizeConfigRepository.save(prizeToUpdate);
        this.logger.log(
          `Stock decremented for prize ${order.prizeConfigurationId}. New stock: ${prizeToUpdate.stock}`,
        );
        if (prizeToUpdate.stock === 0) {
          this.engagementService
            .notifyWatchersOfSoldOut(prizeToUpdate)
            .catch((err) =>
              this.logger.warn(
                `Failed to notify watchers of sold out for ${prizeToUpdate.id}: ${err?.message ?? err}`,
              ),
            );
        }
      } else {
        this.logger.error(
          `Prize ${order.prizeConfigurationId} not found for stock decrement`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to decrement stock for prize ${order.prizeConfigurationId}: ${error}`,
      );
    }

    this.logger.log(
      `Order ${orderId} marked as ${updated.status} after Stripe ${paymentStatus}`,
    );

    // Send notification emails. For ACH-processing orders the seller
    // email contains a prominent DO-NOT-SHIP banner; the buyer email
    // notes payment is still settling.
    const isPaymentProcessing = paymentStatus === 'processing';
    try {
      await this.sendSellerShopPurchaseNotification(
        updated,
        prize,
        order.user,
        { isPaymentProcessing },
      );
    } catch (error) {
      this.logger.error(
        `Failed to send seller notification email for order ${orderId}:`,
        error,
      );
    }

    try {
      await this.sendBuyerShopPurchaseNotification(updated, prize, order.user, {
        isPaymentProcessing,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send buyer notification email for order ${orderId}:`,
        error,
      );
    }

    return this.mapOrderToDto(updated);
  }

  /**
   * Called from the `payment_intent.succeeded` webhook when an ACH
   * debit finally settles for an order that has been sitting in
   * `payment_processing`. Flips the order to `paid` and notifies the
   * seller that they may now ship. No-op for orders that are already
   * `paid` (card flow) or in a non-processing state.
   */
  async handleAchPaymentSettled(orderId: string): Promise<void> {
    const order = await this.getPrizeOrderById(orderId);

    if (order.status === 'paid') {
      // Card flow finalises at checkout.session.completed; the
      // subsequent payment_intent.succeeded is a no-op.
      return;
    }
    if (order.status !== 'payment_processing') {
      this.logger.warn(
        `handleAchPaymentSettled: order ${orderId} is in unexpected status "${order.status}"; skipping`,
      );
      return;
    }

    order.status = 'paid';
    const updated = await this.prizeOrderRepository.save(order);
    this.logger.log(
      `Order ${orderId} flipped from payment_processing -> paid (ACH settled)`,
    );

    // Notify the seller that the ACH debit has cleared and they can
    // safely ship. We send a lightweight follow-up email (separate
    // template) rather than re-sending the full purchase email.
    try {
      const prize = await this.getPrizeTierById(order.prizeConfigurationId);
      await this.sendSellerPaymentSettledNotification(
        updated,
        prize,
        order.user,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send ACH-settled seller email for order ${orderId}:`,
        error,
      );
    }
  }

  /**
   * Called from the `payment_intent.payment_failed` webhook when an
   * ACH debit bounces (insufficient funds, closed account, etc.) for
   * an order that was sitting in `payment_processing`. Reverts every
   * side-effect that `handlePaymentSuccess` applied: restores stock,
   * refunds any combined-payment CadeCoins, cancels the redemption,
   * marks the order `payment_failed`, and notifies both the buyer
   * (via the standard payment-failed email upstream) and the seller.
   *
   * Returns `true` if the order was reverted (i.e. it was actually
   * in `payment_processing`), so callers can decide whether to also
   * send the buyer-facing failure email.
   */
  async handleAchPaymentFailed(orderId: string): Promise<boolean> {
    const order = await this.getPrizeOrderById(orderId);

    if (order.status !== 'payment_processing') {
      // Pre-success failures (status === 'buy_attempted' or 'pending')
      // never decremented stock/created redemption, so there's
      // nothing to revert here.
      return false;
    }

    const prize = await this.getPrizeTierById(order.prizeConfigurationId);

    // Restore stock (the slot we reserved at checkout.session.completed)
    try {
      const prizeToUpdate = await this.prizeConfigRepository.findOne({
        where: { id: order.prizeConfigurationId },
      });
      if (prizeToUpdate) {
        prizeToUpdate.stock = (prizeToUpdate.stock || 0) + 1;
        await this.prizeConfigRepository.save(prizeToUpdate);
        this.logger.log(
          `Stock restored for prize ${order.prizeConfigurationId} (ACH failure). New stock: ${prizeToUpdate.stock}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to restore stock for prize ${order.prizeConfigurationId}: ${error}`,
      );
    }

    // Refund any combined-payment CadeCoins that were deducted up-front
    if (order.paymentMethod === 'combined' && order.coinsDeducted > 0) {
      try {
        await this.walletService.addCadeCoins(
          order.userId,
          order.coinsDeducted,
          `Refund: ACH payment failed for ${prize.name}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to refund CadeCoins for order ${orderId} after ACH failure: ${error}`,
        );
      }
    }

    // Delete the redemption row we created at checkout.session.completed.
    // The ShippingStatus enum has no CANCELLED value, so we just remove
    // the row entirely; ops can rebuild it from the prize_order audit
    // trail if the buyer ever pays via another method.
    try {
      await this.prizeRedemptionRepository.delete({ prizeOrderId: order.id });
    } catch (error) {
      this.logger.error(
        `Failed to delete redemption for order ${orderId}: ${error}`,
      );
    }

    order.status = 'payment_failed';
    const updated = await this.prizeOrderRepository.save(order);
    this.logger.log(
      `Order ${orderId} marked as payment_failed after ACH bounce`,
    );

    // Notify the seller that the sale fell through.
    try {
      await this.sendSellerPaymentFailedNotification(
        updated,
        prize,
        order.user,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send ACH-failed seller email for order ${orderId}:`,
        error,
      );
    }

    return true;
  }

  private async sendSellerShopPurchaseNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
    options: { isPaymentProcessing?: boolean } = {},
  ): Promise<void> {
    try {
      // Determine recipient: admin for CardCade items, seller for seller-owned items
      let recipientEmail: string;
      let recipientName: string;
      // In-person items don't need a Mark-as-Shipped CTA — leave undefined
      // so the EJS template's `<% if (params.markShippedUrl) %>` guard hides it.
      let markShippedUrl: string | undefined;
      const isInPerson = prize.isInPerson === true;

      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );

      if (!prize.createdBy) {
        // CardCade (admin) item - send to admin email
        recipientEmail =
          this.configService.get<string>('ADMIN_EMAIL') ||
          'contact@cardcade.fun';
        recipientName = 'CardCade Admin';
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl}/admin/prizes/redemptions?orderId=${order.id}`;
      } else {
        // Seller-owned item
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });

        if (!seller || !seller.email) {
          this.logger.warn(
            `Seller ${prize.createdBy} not found or has no email for order ${order.id}`,
          );
          return;
        }

        recipientEmail = seller.email;
        recipientName = seller.name || seller.username;
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl}/seller/shop/manage?tab=orders&orderId=${order.id}`;
      }

      // Show the recipient the amount without the buyer service fee
      const BUYER_FEE_PERCENT = BUYER_PROCESSING_FEE_PERCENT;
      const charged = parseFloat(order.usdCharged?.toString() || '0');
      const sellerVisibleAmount =
        charged > 0
          ? parseFloat((charged / (1 + BUYER_FEE_PERCENT / 100)).toFixed(2))
          : order.totalPrice;

      const shipping: PrizeOrder['shippingAddress'] = order.shippingAddress || {
        firstName: '',
        lastName: '',
        addressLine1: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
      };

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [recipientEmail],
          subject: `New Sale! ${prize.name} has been purchased 🎉`,
          params: {
            sellerName: recipientName,
            itemName: prize.name,
            buyerName: buyer.name || buyer.username,
            amount: sellerVisibleAmount,
            orderId: order.id,
            purchaseDate: new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
            buyerFullName: buyer.name || buyer.username,
            shippingAddressLine1: isInPerson ? '' : shipping.addressLine1 || '',
            shippingAddressLine2: isInPerson ? '' : shipping.addressLine2 || '',
            shippingCity: isInPerson ? '' : shipping.city || '',
            shippingState: isInPerson ? '' : shipping.state || '',
            shippingZipCode: isInPerson ? '' : shipping.zipCode || '',
            shippingCountry: isInPerson ? '' : shipping.country || '',
            markShippedUrl,
            isPaymentProcessing: options.isPaymentProcessing === true,
          },
        },
        'seller_shop_purchase',
      );
      this.logger.log(
        `Shop purchase notification sent to ${recipientEmail} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send shop purchase email for order ${order.id}:`,
        emailError,
      );
    }
  }

  private async sendBuyerShopPurchaseNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
    options: { isPaymentProcessing?: boolean } = {},
  ): Promise<void> {
    if (!buyer.email) {
      this.logger.warn(`Buyer ${buyer.id} has no email for order ${order.id}`);
      return;
    }

    try {
      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );

      // Look up seller name
      let sellerName = 'CardCade';
      if (prize.createdBy) {
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });
        if (seller) {
          sellerName = seller.name || seller.username;
        }
      }

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [buyer.email],
          subject: `Purchase Confirmed! ${prize.name} 🎉`,
          params: {
            buyerName: buyer.name || buyer.username,
            itemName: prize.name,
            sellerName,
            amount: parseFloat(order.totalPrice?.toString() || '0'),
            orderId: order.id,
            purchaseDate: new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
            shopUrl: `${frontendUrl}/shop`,
            isPaymentProcessing: options.isPaymentProcessing === true,
          },
        },
        'buyer_shop_purchase',
      );
      this.logger.log(
        `Buyer shop purchase notification sent to ${buyer.email} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send buyer shop purchase email for order ${order.id}:`,
        emailError,
      );
    }
  }

  /**
   * Notify seller/admin that an ACH payment has fully settled and the
   * order is now safe to ship.
   */
  private async sendSellerPaymentSettledNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
  ): Promise<void> {
    try {
      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );
      const isInPerson = prize.isInPerson === true;

      let recipientEmail: string;
      let recipientName: string;
      let markShippedUrl: string | undefined;

      if (!prize.createdBy) {
        recipientEmail =
          this.configService.get<string>('ADMIN_EMAIL') ||
          'contact@cardcade.fun';
        recipientName = 'CardCade Admin';
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl}/admin/prizes/redemptions?orderId=${order.id}`;
      } else {
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });
        if (!seller || !seller.email) {
          this.logger.warn(
            `Seller ${prize.createdBy} not found or has no email for settled order ${order.id}`,
          );
          return;
        }
        recipientEmail = seller.email;
        recipientName = seller.name || seller.username;
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl}/seller/shop/manage?tab=orders&orderId=${order.id}`;
      }

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [recipientEmail],
          subject: `Payment Settled — Safe to Ship: ${prize.name}`,
          params: {
            sellerName: recipientName,
            itemName: prize.name,
            buyerName: buyer.name || buyer.username,
            orderId: order.id,
            markShippedUrl,
          },
        },
        'seller_payment_settled',
      );
      this.logger.log(
        `Payment-settled notification sent to ${recipientEmail} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send payment-settled email for order ${order.id}:`,
        emailError,
      );
    }
  }

  /**
   * Notify seller/admin that an ACH payment failed and the order has been
   * reverted (stock restored, redemption removed).
   */
  private async sendSellerPaymentFailedNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
  ): Promise<void> {
    try {
      let recipientEmail: string;
      let recipientName: string;

      if (!prize.createdBy) {
        recipientEmail =
          this.configService.get<string>('ADMIN_EMAIL') ||
          'contact@cardcade.fun';
        recipientName = 'CardCade Admin';
      } else {
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });
        if (!seller || !seller.email) {
          this.logger.warn(
            `Seller ${prize.createdBy} not found or has no email for failed order ${order.id}`,
          );
          return;
        }
        recipientEmail = seller.email;
        recipientName = seller.name || seller.username;
      }

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [recipientEmail],
          subject: `Payment Failed — Order Cancelled: ${prize.name}`,
          params: {
            sellerName: recipientName,
            itemName: prize.name,
            buyerName: buyer.name || buyer.username,
            orderId: order.id,
          },
        },
        'seller_payment_failed',
      );
      this.logger.log(
        `Payment-failed notification sent to ${recipientEmail} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send payment-failed email for order ${order.id}:`,
        emailError,
      );
    }
  }

  private async ensureRedemptionForOrder(
    order: PrizeOrder,
    prize: PrizeConfiguration,
  ): Promise<void> {
    let prizeCategory: PrizeCategory = PrizeCategory.SLAB;
    if (prize.category === 'sealed') {
      prizeCategory = PrizeCategory.SEALED;
    } else if (prize.category === 'raw') {
      prizeCategory = PrizeCategory.RAW;
    }
    const redemption = this.prizeRedemptionRepository.create({
      userId: order.userId,
      prizeConfigurationId: order.prizeConfigurationId,
      prizeOrderId: order.id,
      dateRedeemed: new Date(),
      prizeTier: prize.prizeTier,
      prizeCategory,
      shippingStatus: ShippingStatus.OPEN,
      fulfilled: false,
    });

    await this.prizeRedemptionRepository.save(redemption);
  }

  /**
   * Get a prize order by ID
   */
  async getPrizeOrderById(id: string): Promise<PrizeOrder> {
    const order = await this.prizeOrderRepository.findOne({
      where: { id },
      relations: ['user', 'prizeConfiguration'],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  /**
   * Get all orders for a user
   */
  async getUserOrders(userId: string): Promise<PrizeOrderResponseDto[]> {
    const orders = await this.prizeOrderRepository.find({
      where: { userId },
      relations: [
        'prizeConfiguration',
        'prizeConfiguration.itemImages',
        'prizeConfiguration.creator',
      ],
      order: { createdAt: 'DESC' },
    });

    return orders.map((order) => this.mapOrderToDto(order));
  }

  /**
   * Get recent purchases by username (public endpoint).
   * Returns limited purchase info suitable for public profile display.
   */
  async getRecentPurchasesByUsername(
    username: string,
    limit: number = 6,
  ): Promise<any[]> {
    const user = await this.userRepository.findOne({
      where: { username, isActive: true },
    });

    if (!user) {
      return [];
    }

    const orders = await this.prizeOrderRepository.find({
      where: {
        userId: user.id,
        status: In(['paid', 'shipped', 'delivered']),
      },
      relations: [
        'prizeConfiguration',
        'prizeConfiguration.itemImages',
        'prizeConfiguration.creator',
      ],
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return orders.map((order) => ({
      id: order.id,
      createdAt: order.createdAt,
      status: order.status,
      prizeConfig: {
        name: order.prizeConfiguration?.name || 'Unknown Item',
        category: order.prizeConfiguration?.category || null,
        image: order.prizeConfiguration?.imageUrl || null,
        images: (order.prizeConfiguration?.itemImages || [])
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((img) => img.imageUrl),
        sellerUsername: order.prizeConfiguration?.creator?.username || null,
        sellerShopName:
          order.prizeConfiguration?.creator?.shopName ||
          order.prizeConfiguration?.creator?.username ||
          null,
      },
    }));
  }

  async getShopOrders(userId: string): Promise<PrizeOrderResponseDto[]> {
    const orders = await this.prizeOrderRepository.find({
      where: {
        prizeConfiguration: {
          createdBy: userId,
        },
      },
      relations: [
        'prizeConfiguration',
        'prizeConfiguration.itemImages',
        'user',
      ],
      order: { createdAt: 'DESC' },
    });

    return orders.map((order) => this.mapOrderToDto(order));
  }

  /**
   * Get all orders for admins
   */
  async getAllOrders(filterDto?: {
    range?: string;
    status?: string;
  }): Promise<{ data: PrizeOrderResponseDto[]; total: number }> {
    const query = this.prizeOrderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.prizeConfiguration', 'prize');

    if (filterDto?.status && filterDto.status !== 'all') {
      query.where('order.status = :status', { status: filterDto.status });
    }

    const total = await query.getCount();
    let data = await query.orderBy('order.createdAt', 'DESC').getMany();

    // Parse range for pagination
    if (filterDto?.range) {
      try {
        const [start, end] = JSON.parse(filterDto.range);
        data = data.slice(start, end);
      } catch {
        // Invalid range format, return all
      }
    }

    return {
      data: data.map((order) => this.mapOrderToDto(order)),
      total,
    };
  }

  /**
   * Get global sales feed (all completed orders, public endpoint).
   * Returns paginated completed sales with item, buyer, and seller info.
   */
  async getGlobalSales(filterDto?: {
    range?: string;
    q?: string;
  }): Promise<{ data: any[]; total: number }> {
    const query = this.prizeOrderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.prizeConfiguration', 'prize')
      .leftJoinAndSelect('prize.itemImages', 'itemImages')
      // Surface auction bid count for items sold through the auction flow
      // so the buyer-facing detail dialog can show competition history.
      .leftJoin('prize.auction', 'auction')
      .addSelect(['auction.id', 'auction.bidCount'])
      .leftJoin('prize.creator', 'seller')
      .addSelect([
        'seller.id',
        'seller.username',
        'seller.shopName',
        'seller.name',
      ])
      .where('order.status IN (:...statuses)', {
        statuses: ['paid', 'shipped', 'delivered'],
      });

    if (filterDto?.q) {
      query.andWhere(
        '(LOWER(prize.name) ILIKE LOWER(:q) OR LOWER(user.username) ILIKE LOWER(:q) OR LOWER(seller.username) ILIKE LOWER(:q))',
        { q: `%${filterDto.q}%` },
      );
    }

    query.orderBy('order.createdAt', 'DESC');

    const total = await query.getCount();

    // Parse range for pagination
    const range: [number, number] = filterDto?.range
      ? JSON.parse(filterDto.range)
      : [0, 10];
    const [offset, limit] = range;
    query.skip(offset).take(limit);

    const orders = await query.getMany();

    const data = orders.map((order) => ({
      id: order.id,
      createdAt: order.createdAt.toISOString(),
      itemName: order.prizeConfiguration?.name || 'Unknown Item',
      itemImage: order.prizeConfiguration?.imageUrl || null,
      itemImages: order.prizeConfiguration?.itemImages
        ? order.prizeConfiguration.itemImages
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((img) => img.imageUrl)
        : [],
      itemCategory: order.prizeConfiguration?.category || null,
      totalPrice: parseFloat(order.totalPrice?.toString() || '0'),
      paymentMethod: order.paymentMethod,
      buyerUsername: order.user?.username || 'Unknown',
      sellerUsername: order.prizeConfiguration?.creator?.username || 'CardCade',
      sellerDisplayName:
        order.prizeConfiguration?.creator?.shopName ||
        order.prizeConfiguration?.creator?.name ||
        order.prizeConfiguration?.creator?.username ||
        'CardCade',
      status: order.status,
      // Auction provenance for the detail dialog. `bidCount` is null
      // for non-auction sales so the UI can hide the row.
      saleType: order.prizeConfiguration?.saleType || 'fixed_price',
      auctionBidCount: order.prizeConfiguration?.auction?.bidCount ?? null,
    }));

    return { data, total };
  }

  /**
   * Admin: paginated list of all completed sales transactions across the
   * platform. Supports date-range, payment-method, and free-text filters.
   *
   * Completed = order.status IN (paid, shipped, delivered). We intentionally
   * exclude pending/buy_attempted/offer_* so totals reflect captured revenue.
   */
  async getAdminSalesHistory(filterDto?: {
    from?: string;
    to?: string;
    paymentMethod?: 'crypto' | 'noncrypto' | 'all';
    range?: string;
    q?: string;
  }): Promise<{ data: any[]; total: number }> {
    const completedStatuses = ['paid', 'shipped', 'delivered'];

    const query = this.prizeOrderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.prizeConfiguration', 'prize')
      .leftJoin('prize.creator', 'seller')
      .addSelect([
        'seller.id',
        'seller.username',
        'seller.shopName',
        'seller.name',
      ])
      .where('order.status IN (:...statuses)', {
        statuses: completedStatuses,
      });

    if (filterDto?.from) {
      query.andWhere('order.createdAt >= :from', { from: filterDto.from });
    }
    if (filterDto?.to) {
      query.andWhere('order.createdAt <= :to', { to: filterDto.to });
    }
    if (filterDto?.paymentMethod === 'crypto') {
      query.andWhere(`order.paymentMethod = :pm`, { pm: 'crypto' });
    } else if (filterDto?.paymentMethod === 'noncrypto') {
      query.andWhere(`order.paymentMethod <> :pm`, { pm: 'crypto' });
    }
    if (filterDto?.q) {
      query.andWhere(
        '(LOWER(prize.name) ILIKE LOWER(:q) OR LOWER(user.username) ILIKE LOWER(:q) OR LOWER(user.email) ILIKE LOWER(:q) OR LOWER(seller.username) ILIKE LOWER(:q))',
        { q: `%${filterDto.q}%` },
      );
    }

    query.orderBy('order.createdAt', 'DESC');

    const total = await query.getCount();

    const range: [number, number] = filterDto?.range
      ? JSON.parse(filterDto.range)
      : [0, 25];
    const [offset, limit] = range;
    query.skip(offset).take(limit);

    const orders = await query.getMany();

    const data = orders.map((order) => ({
      id: order.id,
      createdAt: order.createdAt.toISOString(),
      itemName: order.prizeConfiguration?.name || 'Unknown Item',
      totalPrice: parseFloat(order.totalPrice?.toString() || '0'),
      usdCharged: parseFloat(order.usdCharged?.toString() || '0'),
      coinsDeducted: order.coinsDeducted ?? 0,
      paymentMethod: order.paymentMethod,
      status: order.status,
      buyerUsername: order.user?.username || 'Unknown',
      buyerEmail: order.user?.email || null,
      sellerUsername: order.prizeConfiguration?.creator?.username || 'CardCade',
      cryptoTxSignature: order.cryptoTxSignature || null,
      cryptoBuyerWallet: order.cryptoBuyerWallet || null,
    }));

    return { data, total };
  }

  /**
   * Admin: monthly aggregate summary of completed sales. Returns one row per
   * month for the requested window, including crypto vs non-crypto splits so
   * the UI can render a "How much we made / how much in crypto" overview.
   *
   * Numbers are USD (PrizeOrder.totalPrice is stored in USD already), and
   * platform fees are reconstructed per order (not estimated) using the same
   * fee rules used at checkout.
   */
  async getAdminSalesSummary(filterDto?: { months?: number }): Promise<{
    months: Array<{
      month: string; // ISO date for the first day of the month (UTC)
      totalRevenue: number;
      cryptoRevenue: number;
      nonCryptoRevenue: number;
      platformFees: number;
      cryptoPlatformFees: number;
      nonCryptoPlatformFees: number;
      orderCount: number;
      cryptoOrderCount: number;
      nonCryptoOrderCount: number;
    }>;
    totals: {
      totalRevenue: number;
      cryptoRevenue: number;
      nonCryptoRevenue: number;
      platformFees: number;
      cryptoPlatformFees: number;
      nonCryptoPlatformFees: number;
      orderCount: number;
      cryptoOrderCount: number;
      nonCryptoOrderCount: number;
    };
    feeAssumptions: {
      nonCryptoBuyerFeePercent: number;
      nonCryptoSellerFeePercent: number;
      cryptoCombinedBps: number;
    };
  }> {
    const months = Math.max(1, Math.min(filterDto?.months ?? 12, 60));

    // Compute the window cutoff in JS so we don't depend on Postgres-specific
    // interval-arithmetic with bound parameters (which TypeORM occasionally
    // mishandles). `cutoff` = first day of the (months-1) months ago.
    const now = new Date();
    const cutoff = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
    );

    const NON_CRYPTO_BUYER_FEE_PCT = BUYER_PROCESSING_FEE_PERCENT;
    const NON_CRYPTO_BASE_SELLER_FEE_PCT = 4;
    const CRYPTO_BUYER_FEE_BPS = 100;
    const CRYPTO_DEFAULT_SELLER_FEE_BPS = 100;

    const toCents = (usd: number): number => Math.round(usd * 100);
    const toUsd = (cents: number): number => cents / 100;
    const round2 = (usd: number): number => Math.round(usd * 100) / 100;

    type MonthlyBucket = {
      month: string;
      totalRevenue: number;
      cryptoRevenue: number;
      nonCryptoRevenue: number;
      platformFees: number;
      cryptoPlatformFees: number;
      nonCryptoPlatformFees: number;
      orderCount: number;
      cryptoOrderCount: number;
      nonCryptoOrderCount: number;
    };

    const emptyBucket = (monthIso: string): MonthlyBucket => ({
      month: monthIso,
      totalRevenue: 0,
      cryptoRevenue: 0,
      nonCryptoRevenue: 0,
      platformFees: 0,
      cryptoPlatformFees: 0,
      nonCryptoPlatformFees: 0,
      orderCount: 0,
      cryptoOrderCount: 0,
      nonCryptoOrderCount: 0,
    });

    const monthMap = new Map<string, MonthlyBucket>();

    type SummaryOrderRow = {
      created_at: Date | string;
      payment_method: 'coins' | 'usd' | 'combined' | 'crypto';
      total_price: string | null;
      shipping_cost_usd: string | null;
      seller_stripe_account_id: string | null;
      seller_admin_fee_override_percent: string | null;
      seller_lifetime_coins_earned: string | null;
      seller_crypto_override_fee_bps: string | null;
    };

    let rows: SummaryOrderRow[] = [];

    try {
      rows = await this.prizeOrderRepository
        .createQueryBuilder('o')
        .leftJoin('o.prizeConfiguration', 'prize')
        .leftJoin('prize.creator', 'seller')
        .leftJoin('seller.wallet', 'wallet')
        .select('o.createdAt', 'created_at')
        .addSelect('o.payment_method', 'payment_method')
        .addSelect('COALESCE(o.total_price, 0)', 'total_price')
        .addSelect('COALESCE(prize.shipping_cost_usd, 0)', 'shipping_cost_usd')
        .addSelect('seller.stripe_account_id', 'seller_stripe_account_id')
        .addSelect(
          'seller.admin_fee_override_percent',
          'seller_admin_fee_override_percent',
        )
        .addSelect(
          'wallet.lifetime_coins_earned',
          'seller_lifetime_coins_earned',
        )
        .addSelect(
          'seller.crypto_override_fee_bps',
          'seller_crypto_override_fee_bps',
        )
        .where('o.status IN (:...statuses)', {
          statuses: ['paid', 'shipped', 'delivered'],
        })
        .andWhere('o.createdAt >= :cutoff', { cutoff })
        .getRawMany();
    } catch (err) {
      this.logger.error(
        `getAdminSalesSummary aggregate query failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    for (const row of rows) {
      const createdAt = new Date(row.created_at);
      if (Number.isNaN(createdAt.getTime())) {
        continue;
      }

      const monthStart = new Date(
        Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), 1),
      );
      const monthKey = monthStart.toISOString().slice(0, 7);
      const bucket =
        monthMap.get(monthKey) ?? emptyBucket(monthStart.toISOString());

      const totalPriceUsd = parseFloat(row.total_price ?? '0');
      if (!Number.isFinite(totalPriceUsd) || totalPriceUsd <= 0) {
        monthMap.set(monthKey, bucket);
        continue;
      }

      bucket.totalRevenue += totalPriceUsd;
      bucket.orderCount += 1;

      let orderPlatformFeeUsd = 0;
      if (row.payment_method === 'crypto') {
        bucket.cryptoRevenue += totalPriceUsd;
        bucket.cryptoOrderCount += 1;

        const sellerFeeBps =
          row.seller_crypto_override_fee_bps !== null &&
          row.seller_crypto_override_fee_bps !== undefined
            ? Number(row.seller_crypto_override_fee_bps)
            : CRYPTO_DEFAULT_SELLER_FEE_BPS;
        const combinedBps = CRYPTO_BUYER_FEE_BPS + sellerFeeBps;
        orderPlatformFeeUsd = (totalPriceUsd * combinedBps) / 10000;
        bucket.cryptoPlatformFees += orderPlatformFeeUsd;
      } else {
        bucket.nonCryptoRevenue += totalPriceUsd;
        bucket.nonCryptoOrderCount += 1;

        // total_price = subtotal + buyerFee, where buyerFee is 3% of
        // (subtotal - shipping). Solve subtotal from stored total_price.
        const shippingUsd = Math.max(
          0,
          parseFloat(row.shipping_cost_usd ?? '0'),
        );
        const subtotalUsd =
          (totalPriceUsd + (NON_CRYPTO_BUYER_FEE_PCT / 100) * shippingUsd) /
          (1 + NON_CRYPTO_BUYER_FEE_PCT / 100);

        const subtotalCents = toCents(subtotalUsd);
        const shippingCents = toCents(shippingUsd);
        const buyerFeeCents = calculateBuyerItemFeeCents(
          subtotalCents,
          shippingCents,
        );

        // CardCade-as-seller (admin-owned prize, no Stripe Connect account):
        // platform captures the full amount, but only the buyer service fee
        // is actually a fee — the rest is CardCade primary-sale revenue.
        // Without this guard the platform fees number double-counts the
        // primary-sale revenue.
        if (!row.seller_stripe_account_id) {
          orderPlatformFeeUsd = toUsd(buyerFeeCents);
        } else {
          const sellerFeePercent = getEffectiveSellerFeePercent({
            lifetimeCadeCoins: Number(row.seller_lifetime_coins_earned ?? 0),
            adminFeeOverridePercent:
              row.seller_admin_fee_override_percent !== null &&
              row.seller_admin_fee_override_percent !== undefined
                ? Number(row.seller_admin_fee_override_percent)
                : null,
          });
          const sellerFeeCents = calculateSellerFeeCents(
            subtotalCents,
            sellerFeePercent,
          );

          orderPlatformFeeUsd = toUsd(buyerFeeCents + sellerFeeCents);
        }

        bucket.nonCryptoPlatformFees += orderPlatformFeeUsd;
      }

      bucket.platformFees += orderPlatformFeeUsd;
      monthMap.set(monthKey, bucket);
    }

    const monthsOut: MonthlyBucket[] = [];

    const cursor = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    for (let i = 0; i < months; i++) {
      const key = cursor.toISOString().slice(0, 7);
      const bucket = monthMap.get(key) ?? emptyBucket(cursor.toISOString());
      monthsOut.push({
        ...bucket,
        totalRevenue: round2(bucket.totalRevenue),
        cryptoRevenue: round2(bucket.cryptoRevenue),
        nonCryptoRevenue: round2(bucket.nonCryptoRevenue),
        platformFees: round2(bucket.platformFees),
        cryptoPlatformFees: round2(bucket.cryptoPlatformFees),
        nonCryptoPlatformFees: round2(bucket.nonCryptoPlatformFees),
      });
      // Step back one month
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }

    const totals = monthsOut.reduce(
      (acc, m) => ({
        totalRevenue: acc.totalRevenue + m.totalRevenue,
        cryptoRevenue: acc.cryptoRevenue + m.cryptoRevenue,
        nonCryptoRevenue: acc.nonCryptoRevenue + m.nonCryptoRevenue,
        platformFees: acc.platformFees + m.platformFees,
        cryptoPlatformFees: acc.cryptoPlatformFees + m.cryptoPlatformFees,
        nonCryptoPlatformFees:
          acc.nonCryptoPlatformFees + m.nonCryptoPlatformFees,
        orderCount: acc.orderCount + m.orderCount,
        cryptoOrderCount: acc.cryptoOrderCount + m.cryptoOrderCount,
        nonCryptoOrderCount: acc.nonCryptoOrderCount + m.nonCryptoOrderCount,
      }),
      {
        totalRevenue: 0,
        cryptoRevenue: 0,
        nonCryptoRevenue: 0,
        platformFees: 0,
        cryptoPlatformFees: 0,
        nonCryptoPlatformFees: 0,
        orderCount: 0,
        cryptoOrderCount: 0,
        nonCryptoOrderCount: 0,
      },
    );

    return {
      months: monthsOut,
      totals: {
        ...totals,
        totalRevenue: round2(totals.totalRevenue),
        cryptoRevenue: round2(totals.cryptoRevenue),
        nonCryptoRevenue: round2(totals.nonCryptoRevenue),
        platformFees: round2(totals.platformFees),
        cryptoPlatformFees: round2(totals.cryptoPlatformFees),
        nonCryptoPlatformFees: round2(totals.nonCryptoPlatformFees),
      },
      feeAssumptions: {
        nonCryptoBuyerFeePercent: NON_CRYPTO_BUYER_FEE_PCT,
        nonCryptoSellerFeePercent: NON_CRYPTO_BASE_SELLER_FEE_PCT,
        cryptoCombinedBps: CRYPTO_BUYER_FEE_BPS + CRYPTO_DEFAULT_SELLER_FEE_BPS,
      },
    };
  }

  /**
   * Get offer orders for a specific seller's shop items
   */
  async getSellerOffers(
    sellerId: string,
    filterDto?: { range?: string; status?: string },
  ): Promise<{ data: PrizeOrderResponseDto[]; total: number }> {
    const query = this.prizeOrderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.prizeConfiguration', 'prize')
      .where('prize.createdBy = :sellerId', { sellerId })
      .andWhere('prize.showOnShop = :showOnShop', { showOnShop: true })
      .andWhere('order.offerAmount IS NOT NULL');

    if (filterDto?.status && filterDto.status !== 'all') {
      query.andWhere('order.status = :status', { status: filterDto.status });
    }

    const total = await query.getCount();
    let data = await query.orderBy('order.createdAt', 'DESC').getMany();

    if (filterDto?.range) {
      try {
        const [start, end] = JSON.parse(filterDto.range);
        data = data.slice(start, end);
      } catch {
        // Invalid range format, return all
      }
    }

    return {
      data: data.map((order) => this.mapOrderToDto(order)),
      total,
    };
  }

  private async validateSellerOfferAccess(
    sellerId: string,
    orderId: string,
  ): Promise<PrizeOrder> {
    const order = await this.getPrizeOrderById(orderId);
    const ownerId = order.prizeConfiguration?.createdBy;

    if (
      !order.prizeConfiguration?.showOnShop ||
      !ownerId ||
      ownerId !== sellerId
    ) {
      throw new ForbiddenException(
        'You can only manage offers for your own shop items',
      );
    }

    return order;
  }

  async sellerCounterOffer(
    sellerId: string,
    orderId: string,
    dto: CounterOfferDto,
  ): Promise<PrizeOrderResponseDto> {
    await this.validateSellerOfferAccess(sellerId, orderId);
    return this.counterOffer(orderId, dto);
  }

  async sellerAcceptOffer(
    sellerId: string,
    orderId: string,
  ): Promise<PrizeOrderResponseDto> {
    await this.validateSellerOfferAccess(sellerId, orderId);
    return this.acceptOffer(orderId);
  }

  async sellerRejectOffer(
    sellerId: string,
    orderId: string,
  ): Promise<PrizeOrderResponseDto> {
    await this.validateSellerOfferAccess(sellerId, orderId);
    return this.rejectOffer(orderId);
  }

  /**
   * Update order status
   */
  async updateOrderStatus(
    orderId: string,
    status:
      | 'pending'
      | 'buy_attempted'
      | 'paid'
      | 'processing'
      | 'payment_processing'
      | 'payment_failed'
      | 'shipped'
      | 'delivered'
      | 'cancelled',
  ): Promise<PrizeOrderResponseDto> {
    const order = await this.getPrizeOrderById(orderId);
    order.status = status;
    const updated = await this.prizeOrderRepository.save(order);

    this.logger.log(`Order ${orderId} status updated to ${status}`);

    return this.mapOrderToDto(updated);
  }

  /**
   * Map order entity to DTO
   */
  private mapOrderToDto(order: PrizeOrder): PrizeOrderResponseDto {
    return {
      id: order.id,
      userId: order.userId,
      username: order.user?.username,
      prizeConfigId: order.prizeConfigurationId,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod,
      coinsDeducted: order.coinsDeducted,
      usdCharged: parseFloat(order.usdCharged.toString()),
      totalPrice: parseFloat(order.totalPrice.toString()),
      stripeSessionId: order.stripeSessionId,
      stripePaymentMethod: order.stripePaymentMethod ?? null,
      cryptoTxSignature: order.cryptoTxSignature ?? undefined,
      status: order.status,
      offerAmount: order.offerAmount
        ? parseFloat(order.offerAmount.toString())
        : undefined,
      counterOfferAmount: order.counterOfferAmount
        ? parseFloat(order.counterOfferAmount.toString())
        : undefined,
      offerNotes: order.offerNotes,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      user: order.user
        ? {
            username: order.user.username,
            email: order.user.email,
            firstName: order.shippingAddress?.firstName,
            lastName: order.shippingAddress?.lastName,
          }
        : undefined,
      prizeConfig: order.prizeConfiguration
        ? {
            name: order.prizeConfiguration.name,
            category: order.prizeConfiguration.category,
            image: order.prizeConfiguration.imageUrl ?? '',
            images: order.prizeConfiguration.itemImages
              ? order.prizeConfiguration.itemImages
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((img) => img.imageUrl)
              : [],
            sellerUsername: order.prizeConfiguration.creator?.username,
          }
        : undefined,
    };
  }

  /**
   * Make an offer on a prize item
   */
  async makeOffer(
    userId: string,
    dto: MakeOfferDto,
  ): Promise<PrizeOrderResponseDto> {
    // Validate prize exists and is active
    const prize = await this.getPrizeTierById(dto.prizeConfigId);
    if (!prize.isActive) {
      throw new BadRequestException('This prize is not available');
    }
    if (prize.saleType === PrizeSaleType.AUCTION) {
      throw new BadRequestException(
        'Auction items do not accept offers. Place a bid instead.',
      );
    }
    if (prize.purchaseOption === PrizePurchaseOption.BUY_ONLY) {
      throw new BadRequestException(
        'This prize is buy-only and does not accept offers',
      );
    }

    // Block non-Pro users from making offers on Pro-only or early-access items
    const buyer = await this.userRepository.findOne({ where: { id: userId } });
    if (!buyer?.isProSubscriber) {
      const now = new Date();
      if (prize.isProOnly) {
        throw new ForbiddenException(
          'This item is exclusive to CardCade Pro members.',
        );
      }
      if (
        prize.proEarlyAccessUntil &&
        new Date(prize.proEarlyAccessUntil as unknown as string) > now
      ) {
        throw new ForbiddenException(
          'This item is in the 24-hour early access window for CardCade Pro members.',
        );
      }
    }

    const SHIPPING_FEE =
      prize.shippingCostUsd != null ? Number(prize.shippingCostUsd) : 5; // Per-item shipping fee (default $5; 0 = Free Shipping)
    const totalWithShipping = dto.offerAmount + SHIPPING_FEE;

    // Create order with offer_made status
    const order = this.prizeOrderRepository.create({
      userId,
      prizeConfigurationId: dto.prizeConfigId,
      shippingAddress: dto.shippingAddress,
      paymentMethod: 'usd', // Offers are USD payment
      coinsDeducted: 0,
      usdCharged: 0, // Will be charged later if accepted
      totalPrice: totalWithShipping,
      offerAmount: dto.offerAmount,
      offerNotes: dto.offerNotes,
      // Lock in the buyer's chosen Stripe method now. Re-read at
      // accept / counter-accept time so the fee rate is the rate the
      // buyer agreed to, with zero client trust at that point.
      stripePaymentMethod: dto.stripePaymentMethod,
      status: 'offer_made',
    });

    const saved = await this.prizeOrderRepository.save(order);

    // Send email notification to seller for shop items, otherwise admin
    try {
      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );
      let recipientEmail =
        this.configService.get<string>('ADMIN_EMAIL') || 'contact@cardcade.fun';
      let subject = `💰 New Prize Offer: ${prize.name}`;
      let reviewUrl = `${frontendUrl}/admin/prizes/redemptions?orderId=${saved.id}`;
      let portalLabel = 'admin panel';

      if (prize.showOnShop && prize.createdBy) {
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });

        if (seller?.email) {
          recipientEmail = seller.email;
          subject = `💰 New Shop Offer: ${prize.name}`;
          reviewUrl = `${frontendUrl}/seller/shop/manage?orderId=${saved.id}`;
          portalLabel = 'seller dashboard';
        }
      }

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [recipientEmail],
          subject,
          params: {
            orderId: saved.id,
            userId,
            prizeName: prize.name,
            offerAmount: dto.offerAmount,
            notes: dto.offerNotes || '',
            adminUrl: frontendUrl,
            reviewUrl,
            portalLabel,
          },
        },
        'offer_made',
      );
    } catch (error) {
      this.logger.error(`Failed to send offer notification email: ${error}`);
    }

    return this.mapOrderToDto(saved);
  }

  /**
   * Admin counter-offers on a user's offer
   */
  async counterOffer(
    orderId: string,
    dto: CounterOfferDto,
  ): Promise<PrizeOrderResponseDto> {
    const order = await this.getPrizeOrderById(orderId);

    if (order.status !== 'offer_made') {
      throw new BadRequestException('Can only counter offer on pending offers');
    }

    order.counterOfferAmount = dto.counterOfferAmount;
    order.offerNotes = dto.offerNotes || order.offerNotes;
    order.status = 'countered';

    const updated = await this.prizeOrderRepository.save(order);

    // Send email to user with counter offer details
    try {
      const prize = await this.getPrizeTierById(order.prizeConfigurationId);
      const user = await this.userRepository.findOne({
        where: { id: order.userId },
      });

      if (user?.email) {
        const frontendUrl = this.configService.get<string>(
          'CLIENT_URL',
          'http://localhost:3000',
        );
        await this.emailsService.sendEmailSMTP(
          {
            toAddress: [user.email],
            subject: `🔄 Counter Offer on ${prize.name}`,
            params: {
              userName: user.username,
              orderId: order.id,
              prizeName: prize.name,
              originalOffer: order.offerAmount || 0,
              counterOffer: dto.counterOfferAmount,
              notes: dto.offerNotes || '',
              acceptUrl: `${frontendUrl}/prizes?acceptCounter=${order.id}`,
              supportUrl: `${frontendUrl}/support`,
            },
          },
          'offer_countered',
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send counter offer email: ${error}`);
    }

    return this.mapOrderToDto(updated);
  }

  /**
   * Admin accepts a user's offer
   */
  async acceptOffer(orderId: string): Promise<PrizeOrderResponseDto> {
    const order = await this.getPrizeOrderById(orderId);

    if (order.status !== 'offer_made' && order.status !== 'countered') {
      throw new BadRequestException('Can only accept pending offers');
    }

    // Determine amount to charge before updating status
    const wasCountered = order.status === 'countered';
    const acceptOfferPrize = await this.getPrizeTierById(
      order.prizeConfigurationId,
    );
    const SHIPPING_FEE =
      acceptOfferPrize.shippingCostUsd != null
        ? Number(acceptOfferPrize.shippingCostUsd)
        : 5;
    const negotiatedAmount =
      wasCountered && order.counterOfferAmount
        ? order.counterOfferAmount
        : order.offerAmount || order.totalPrice;
    const amountToCharge =
      negotiatedAmount === order.totalPrice
        ? negotiatedAmount
        : negotiatedAmount + SHIPPING_FEE;

    order.status = 'offer_accepted';
    const updated = await this.prizeOrderRepository.save(order);

    // Create Stripe checkout session
    const prize = acceptOfferPrize;

    const offerAmountCents = Math.round(amountToCharge * 100);

    // Load seller to check for Stripe Connect account and application fee
    const offerSeller = prize.createdBy
      ? await this.userRepository.findOne({
          where: { id: prize.createdBy },
          relations: ['wallet'],
        })
      : null;

    // Buyer fee applies to item subtotal only (shipping excluded).
    // Rate depends on the Stripe method the buyer locked in when the
    // offer was submitted. Null = legacy row → default to card rate.
    const acceptOfferStripeMethod: 'card' | 'us_bank_account' =
      order.stripePaymentMethod === 'us_bank_account'
        ? 'us_bank_account'
        : 'card';
    const offerShippingCents = Math.round(SHIPPING_FEE * 100);
    const buyerFeeCents = calculateBuyerItemFeeCents(
      offerAmountCents,
      offerShippingCents,
      getBuyerFeePercentForStripeMethod(acceptOfferStripeMethod),
    );
    const totalChargeCents = offerAmountCents + buyerFeeCents;

    const acceptOfferSessionParams = {
      // Locked to the buyer's chosen method (see makeOffer).
      payment_method_types: [
        acceptOfferStripeMethod,
      ] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${prize.name} - Accepted Offer`,
              description: `Offer accepted at $${amountToCharge} + $${(buyerFeeCents / 100).toFixed(2)} service fee`,
            },
            unit_amount: totalChargeCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment' as const,
      success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/purchase-success?orderId=${order.id}`,
      cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/shop?status=cancel&orderId=${order.id}`,
      metadata: {
        orderId: order.id,
        userId: order.userId,
        type: 'prize_offer',
        transactionSubtotalCents: offerAmountCents.toString(),
        buyerFeeCents: buyerFeeCents.toString(),
      },
    };

    if (offerSeller?.stripeAccountId) {
      const sellerLifetimeCadeCoins = Number(
        offerSeller.wallet?.lifetimeCoinsEarned || 0,
      );
      const sellerFeePercent = getEffectiveSellerFeePercent({
        lifetimeCadeCoins: sellerLifetimeCadeCoins,
        adminFeeOverridePercent:
          offerSeller.adminFeeOverridePercent !== null &&
          offerSeller.adminFeeOverridePercent !== undefined
            ? Number(offerSeller.adminFeeOverridePercent)
            : null,
      });
      const sellerFeeAmount = calculateSellerFeeCents(
        offerAmountCents,
        sellerFeePercent,
      );
      const application_fee_amount = sellerFeeAmount + buyerFeeCents;
      const transfer_data = { destination: offerSeller.stripeAccountId };

      (acceptOfferSessionParams as any).payment_intent_data = {
        application_fee_amount,
        transfer_data,
      };
    }

    const session = await this.stripe.checkout.sessions.create(
      acceptOfferSessionParams,
    );

    // Save Stripe session ID and update totals to include buyer fee
    const offerBuyerFeeUsd = buyerFeeCents / 100;
    order.stripeSessionId = session.id;
    order.usdCharged = amountToCharge + offerBuyerFeeUsd;
    order.totalPrice = parseFloat(
      (order.totalPrice + offerBuyerFeeUsd).toString(),
    );
    await this.prizeOrderRepository.save(order);

    // Send email to user with Stripe checkout link
    try {
      const user = await this.userRepository.findOne({
        where: { id: order.userId },
      });

      if (user?.email) {
        const frontendUrl = this.configService.get<string>(
          'CLIENT_URL',
          'http://localhost:3000',
        );
        await this.emailsService.sendEmailSMTP(
          {
            toAddress: [user.email],
            subject: `✅ Your Offer for ${prize.name} Has Been Accepted!`,
            params: {
              userName: user.username,
              orderId: order.id,
              prizeName: prize.name,
              acceptedAmount: amountToCharge,
              checkoutUrl: session.url || '',
              supportUrl: `${frontendUrl}/support`,
            },
          },
          'offer_accepted',
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send offer accepted email: ${error}`);
    }

    return this.mapOrderToDto(updated);
  }

  /**
   * Admin rejects a user's offer
   */
  async rejectOffer(orderId: string): Promise<PrizeOrderResponseDto> {
    const order = await this.getPrizeOrderById(orderId);

    if (order.status !== 'offer_made') {
      throw new BadRequestException('Can only reject pending offers');
    }

    order.status = 'rejected';
    const updated = await this.prizeOrderRepository.save(order);

    // Send email to user
    try {
      const prize = await this.getPrizeTierById(order.prizeConfigurationId);
      const user = await this.userRepository.findOne({
        where: { id: order.userId },
      });

      if (user?.email) {
        const frontendUrl = this.configService.get<string>(
          'CLIENT_URL',
          'http://localhost:3000',
        );
        await this.emailsService.sendEmailSMTP(
          {
            toAddress: [user.email],
            subject: `Update on Your Offer for ${prize.name}`,
            params: {
              userName: user.username,
              prizeName: prize.name,
              offerAmount: order.offerAmount || 0,
              prizesUrl: `${frontendUrl}/prizes`,
              supportUrl: `${frontendUrl}/support`,
            },
          },
          'offer_rejected',
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send offer rejected email: ${error}`);
    }

    return this.mapOrderToDto(updated);
  }

  /**
   * User accepts a counter offer
   */
  async acceptCounterOffer(
    orderId: string,
  ): Promise<{ stripeSessionUrl: string }> {
    const order = await this.getPrizeOrderById(orderId);

    if (order.status !== 'countered') {
      throw new BadRequestException('No counter offer to accept');
    }

    const prize = await this.getPrizeTierById(order.prizeConfigurationId);
    const SHIPPING_FEE =
      prize.shippingCostUsd != null ? Number(prize.shippingCostUsd) : 5;
    const negotiatedAmount = order.counterOfferAmount || order.totalPrice;
    const amountToCharge =
      negotiatedAmount === order.totalPrice
        ? negotiatedAmount
        : negotiatedAmount + SHIPPING_FEE;
    const counterOfferAmountCents = Math.round(amountToCharge * 100);

    // Load seller to check for Stripe Connect account and application fee
    const counterOfferSeller = prize.createdBy
      ? await this.userRepository.findOne({
          where: { id: prize.createdBy },
          relations: ['wallet'],
        })
      : null;

    // Buyer fee applies to item subtotal only (shipping excluded).
    // Rate depends on the Stripe method the buyer locked in when the
    // offer was submitted; null = legacy row → default to card rate.
    const counterOfferStripeMethod: 'card' | 'us_bank_account' =
      order.stripePaymentMethod === 'us_bank_account'
        ? 'us_bank_account'
        : 'card';
    const counterOfferShippingCents = Math.round(SHIPPING_FEE * 100);
    const buyerFeeCents = calculateBuyerItemFeeCents(
      counterOfferAmountCents,
      counterOfferShippingCents,
      getBuyerFeePercentForStripeMethod(counterOfferStripeMethod),
    );
    const totalChargeCents = counterOfferAmountCents + buyerFeeCents;

    // Create Stripe checkout session
    const counterOfferSessionParams = {
      // Locked to the buyer's chosen method (see makeOffer).
      payment_method_types: [
        counterOfferStripeMethod,
      ] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${prize.name} - Counter Offer Accepted`,
              description: `Counter offer accepted at $${amountToCharge} + $${(buyerFeeCents / 100).toFixed(2)} service fee`,
            },
            unit_amount: totalChargeCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment' as const,
      success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/purchase-success?orderId=${order.id}`,
      cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/shop?status=cancel&orderId=${order.id}`,
      metadata: {
        orderId: order.id,
        userId: order.userId,
        type: 'prize_counter_offer',
        transactionSubtotalCents: counterOfferAmountCents.toString(),
        buyerFeeCents: buyerFeeCents.toString(),
      },
    };

    if (counterOfferSeller?.stripeAccountId) {
      const sellerLifetimeCadeCoins = Number(
        counterOfferSeller.wallet?.lifetimeCoinsEarned || 0,
      );
      const sellerFeePercent = getEffectiveSellerFeePercent({
        lifetimeCadeCoins: sellerLifetimeCadeCoins,
        adminFeeOverridePercent:
          counterOfferSeller.adminFeeOverridePercent !== null &&
          counterOfferSeller.adminFeeOverridePercent !== undefined
            ? Number(counterOfferSeller.adminFeeOverridePercent)
            : null,
      });
      const sellerFeeAmount = calculateSellerFeeCents(
        counterOfferAmountCents,
        sellerFeePercent,
      );
      const application_fee_amount = sellerFeeAmount + buyerFeeCents;
      const transfer_data = { destination: counterOfferSeller.stripeAccountId };

      (counterOfferSessionParams as any).payment_intent_data = {
        application_fee_amount,
        transfer_data,
      };
    }

    const session = await this.stripe.checkout.sessions.create(
      counterOfferSessionParams,
    );

    // Update order with Stripe session and include buyer fee in totals
    const counterOfferBuyerFeeUsd = buyerFeeCents / 100;
    order.stripeSessionId = session.id;
    order.usdCharged = amountToCharge + counterOfferBuyerFeeUsd;
    order.totalPrice = parseFloat(
      (order.totalPrice + counterOfferBuyerFeeUsd).toString(),
    );
    order.status = 'offer_accepted';
    await this.prizeOrderRepository.save(order);

    return { stripeSessionUrl: session.url || '' };
  }

  private async awardCadeCoinTransactionRewards(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    transactionSubtotalCents: number,
    source: 'coins_checkout' | 'stripe_checkout',
  ): Promise<void> {
    if (transactionSubtotalCents <= 0) {
      return;
    }

    const rewardCoins = calculateRewardCadeCoinsFromCents(
      transactionSubtotalCents,
    );

    if (rewardCoins <= 0) {
      return;
    }

    const rewardEntityType = 'prize_order_reward';

    try {
      await this.walletService.updateBalance(
        order.userId,
        rewardCoins,
        CurrencyType.CADE_COINS,
        TransactionType.BONUS,
        `Transaction reward for purchase: ${prize.name}`,
        {
          source,
          role: 'buyer',
          rewardCoins,
          transactionSubtotalCents,
        },
        {
          relatedEntityId: `${order.id}:buyer`,
          relatedEntityType: rewardEntityType,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to award buyer reward coins for order ${order.id}: ${error}`,
      );
    }

    if (!prize.createdBy) {
      return;
    }

    try {
      await this.walletService.updateBalance(
        prize.createdBy,
        rewardCoins,
        CurrencyType.CADE_COINS,
        TransactionType.BONUS,
        `Transaction reward for sale: ${prize.name}`,
        {
          source,
          role: 'seller',
          rewardCoins,
          transactionSubtotalCents,
        },
        {
          relatedEntityId: `${order.id}:seller`,
          relatedEntityType: rewardEntityType,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to award seller reward coins for order ${order.id}: ${error}`,
      );
    }
  }

  /**
   * Seller marks an order as shipped
   */
  async sellerMarkAsShipped(
    sellerId: string,
    orderId: string,
    dto: MarkAsShippedDto,
  ): Promise<PrizeOrderResponseDto> {
    const order = await this.getPrizeOrderById(orderId);
    const prize = await this.getPrizeTierById(order.prizeConfigurationId);

    // Verify the seller owns this item
    if (prize.createdBy !== sellerId) {
      throw new ForbiddenException(
        'You do not have permission to update this order',
      );
    }

    // Verify order is paid and not already shipped
    if (order.status !== 'paid') {
      throw new BadRequestException(
        'Only paid orders can be marked as shipped',
      );
    }

    // @ts-expect-error any
    if (order.status === 'shipped' || order.shippedAt) {
      this.logger.warn(`Order ${orderId} is already marked as shipped`);
      return this.mapOrderToDto(order);
    }

    // Update order with shipping information
    order.status = 'shipped';
    order.shippedAt = new Date();
    if (dto.trackingNumber) {
      order.trackingNumber = dto.trackingNumber;
    }
    if (dto.shippingCarrier) {
      order.shippingCarrier = dto.shippingCarrier;
    }

    const updated = await this.prizeOrderRepository.save(order);

    // Send notification email to buyer
    try {
      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [order.user.email],
          subject: `Your ${prize.name} is on the way! 📦`,
          params: {
            buyerName: order.user.name || order.user.username,
            itemName: prize.name,
            orderId: order.id,
            trackingNumber: dto.trackingNumber || '',
            shippingCarrier: dto.shippingCarrier || '',
            shippedDate: new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
          },
        },
        'buyer_item_shipped',
      );
      this.logger.log(
        `Shipping notification sent to buyer ${order.userId} for order ${orderId}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send shipping notification email for order ${orderId}:`,
        emailError,
      );
    }

    return this.mapOrderToDto(updated);
  }

  /**
   * Get seller's orders (shop sales)
   */
  async getSellerOrders(
    sellerId: string,
    filterDto?: { status?: string; range?: string },
  ): Promise<PrizeOrderResponseDto[]> {
    const query = this.prizeOrderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.prizeConfiguration', 'prize')
      .where('prize.created_by = :sellerId', { sellerId })
      .andWhere('order.status IN (:...statuses)', {
        statuses: ['paid', 'shipped', 'delivered'],
      });

    if (filterDto?.status) {
      query.andWhere('order.status = :status', {
        status: filterDto.status,
      });
    }

    const orders = await query.orderBy('order.createdAt', 'DESC').getMany();

    return orders.map((order) => this.mapOrderToDto(order));
  }

  /**
   * Helper: hydrate a list of prize entities into DTOs with the correct
   * `isWatching` flag for the given (optional) requester.
   */
  private async attachIsWatching(
    items: PrizeConfiguration[],
    requesterId?: string | null,
  ): Promise<PrizeConfigurationDto[]> {
    const watched = requesterId
      ? await this.engagementService.getWatchedItemIds(
          requesterId,
          items.map((i) => i.id),
        )
      : new Set<string>();
    const auctionIds = items
      .map((i) => i.auction?.id)
      .filter((id): id is string => !!id);
    const bidderAuctionIds = requesterId
      ? await this.auctionsService.getBidderAuctionIds(requesterId, auctionIds)
      : new Set<string>();
    return items.map((item) =>
      this.mapToDto(item, {
        isWatching: watched.has(item.id),
        auctionViewerUserId: requesterId ?? null,
        auctionIsBidder:
          !!item.auction && bidderAuctionIds.has(item.auction.id),
      }),
    );
  }

  /**
   * Returns the current user's watchlist (most-recently-watched first).
   * Inactive items and items the seller has hidden from the shop are
   * filtered out so the watchlist only shows things the user can still
   * see and interact with.
   */
  async getUserWatchlist(userId: string): Promise<PrizeConfigurationDto[]> {
    const { items } = await this.engagementService.getWatchlistEntities(userId);
    const visible = items.filter(
      (item) => item.isActive && item.showOnShop !== false,
    );
    // Pre-load the bidder set so leader / bidder / proxy fields render
    // correctly for any auction items on the watchlist.
    const auctionIds = visible
      .map((i) => i.auction?.id)
      .filter((id): id is string => !!id);
    const bidderAuctionIds = await this.auctionsService.getBidderAuctionIds(
      userId,
      auctionIds,
    );
    // Everything in this list is by definition watched, so skip the extra
    // round-trip to fetch the watcher set.
    return visible.map((item) =>
      this.mapToDto(item, {
        isWatching: true,
        auctionViewerUserId: userId,
        auctionIsBidder:
          !!item.auction && bidderAuctionIds.has(item.auction.id),
      }),
    );
  }

  /**
   * Returns every prize the user has placed at least one bid on,
   * ordered by their most-recent bid (newest first). Powers the
   * "My Bids" page. Auction summaries are rebuilt with the viewer's
   * userId so `isLeader` and `currentUserProxyMaxUsd` are populated
   * for items where the viewer currently leads.
   */
  async getUserBids(userId: string): Promise<PrizeConfigurationDto[]> {
    const rows = await this.auctionsService.getRecentBidAuctions(userId);
    if (!rows.length) return [];
    const auctionIds = rows.map((r) => r.auctionId);
    // Use QB so we can filter on the auction relation explicitly. The
    // entity's `auction` is OneToOne eager-loaded; we still need an
    // explicit join to filter on its id.
    const items = await this.prizeConfigRepository
      .createQueryBuilder('prize')
      .innerJoinAndSelect('prize.auction', 'auction')
      .leftJoinAndSelect('prize.itemImages', 'itemImages')
      .leftJoinAndSelect('prize.creator', 'creator')
      .where('auction.id IN (:...auctionIds)', { auctionIds })
      .andWhere('prize.isActive = true')
      .getMany();
    // Sort by lastBidAt DESC using the order from the bid query.
    const orderIndex = new Map(rows.map((r, idx) => [r.auctionId, idx]));
    items.sort((a, b) => {
      const ai = a.auction ? (orderIndex.get(a.auction.id) ?? 9999) : 9999;
      const bi = b.auction ? (orderIndex.get(b.auction.id) ?? 9999) : 9999;
      return ai - bi;
    });
    return items.map((item) => {
      const dto = this.mapToDto(item, { isWatching: false });
      if (item.auction) {
        dto.auction = this.auctionsService.buildSummary(item.auction, {
          userId,
          isBidder: true,
        });
      }
      return dto;
    });
  }

  /**
   * Sync read of the cached CardCade crypto-enabled flag, used by
   * `mapToDto` to populate `sellerCryptoEnabled` for items with no
   * creator (`createdBy IS NULL`). If the cached value is stale, fires a
   * non-blocking refresh — the current call returns the previous value.
   */
  private readCardcadeCryptoEnabled(): boolean {
    if (
      Date.now() > this.cardcadeCryptoCache.expiresAt &&
      !this.cardcadeCryptoRefreshing
    ) {
      this.cardcadeCryptoRefreshing = true;
      void this.refreshCardcadeCryptoCache().finally(() => {
        this.cardcadeCryptoRefreshing = false;
      });
    }
    return this.cardcadeCryptoCache.value;
  }

  /**
   * Force-refresh the CardCade crypto-enabled cache. Safe to await from
   * any entry point that wants the very latest value (e.g. immediately
   * after admin saves the toggle).
   */
  private async refreshCardcadeCryptoCache(): Promise<void> {
    try {
      const settings = await this.shopSettingsRepository.findOne({
        where: { shopKey: 'cardcade' },
      });
      const enabled =
        !!settings?.cryptoPaymentsEnabled && !!settings?.cryptoWalletAddress;
      this.cardcadeCryptoCache = {
        value: enabled,
        expiresAt: Date.now() + PrizeService.CARDCADE_FLAG_TTL_MS,
      };
    } catch (err) {
      // Don't poison the cache on transient DB errors. Bump the expiry
      // a little to avoid hot-looping the failing query.
      this.cardcadeCryptoCache = {
        value: this.cardcadeCryptoCache.value,
        expiresAt: Date.now() + 5_000,
      };
      this.logger.warn(
        `[CardCade flag] failed to refresh shop_settings cache: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Map entity to DTO
   */
  private mapToDto(
    entity: PrizeConfiguration,
    opts: {
      isWatching?: boolean;
      /**
       * When provided, the embedded auction summary is built with this
       * userId so `isLeader` and (for the leader) `currentUserProxyMaxUsd`
       * are populated. Without it, list endpoints would always render
       * the anonymous public view and leaders would lose their "Raise
       * your max" CTA on refresh.
       */
      auctionViewerUserId?: string | null;
      /** True when this user has placed at least one bid on this auction. */
      auctionIsBidder?: boolean;
      /**
       * Force the value of `sellerCryptoEnabled` on the resulting DTO.
       * Used by virtual shops (e.g. CardCade) whose items have no creator
       * user — the flag comes from `shop_settings` instead.
       */
      sellerCryptoEnabledOverride?: boolean;
    } = {},
  ): PrizeConfigurationDto {
    const sortedItemImages = (entity.itemImages || [])
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const resolvedCoverImageId =
      entity.coverImageId || sortedItemImages[0]?.id || null;

    const itemImages = sortedItemImages.map((img) => ({
      id: img.id,
      imageUrl: img.imageUrl,
      displayOrder: img.displayOrder,
      isCover: resolvedCoverImageId ? img.id === resolvedCoverImageId : false,
    }));

    const imageUrls =
      itemImages.length > 0
        ? itemImages.map((img) => img.imageUrl)
        : entity.imageUrl
          ? [entity.imageUrl]
          : [];

    return {
      id: entity.id,
      prizeTier: entity.prizeTier,
      amount: Number(entity.amount),
      name: entity.name,
      description: entity.description,
      imageUrl: entity.imageUrl,
      imageUrls,
      itemImages,
      coverImageId: resolvedCoverImageId,
      category: entity.category,
      grade: (entity as any).grade || null,
      stock: entity.stock,
      purchaseOption: entity.purchaseOption,
      brand: entity.brand,
      displayOrderShop: entity.displayOrderShop,
      sellerDisplayOrderShop:
        entity.sellerDisplayOrderShop ?? entity.displayOrderShop,
      displayOrderRedemptions: entity.displayOrderRedemptions,
      featuredDisplayOrder: entity.featuredDisplayOrder,
      showOnRedemptions: entity.showOnRedemptions,
      showOnShop: entity.showOnShop,
      sortByPurchaseOptionShop: entity.sortByPurchaseOptionShop,
      sortByPurchaseOptionRedemptions: entity.sortByPurchaseOptionRedemptions,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      createdBy: entity.createdBy,
      createdByUsername: entity.creator?.username ?? null,
      createdByShopName: entity.creator?.shopName ?? null,
      sellerCryptoEnabled:
        opts.sellerCryptoEnabledOverride ??
        (entity.createdBy === null
          ? this.readCardcadeCryptoEnabled()
          : (entity.creator?.cryptoPaymentsEnabled ?? false)),
      updatedBy: entity.updatedBy,
      ebaySearchQuery: entity.ebaySearchQuery,
      ebayMarketLastCalculatedAt: entity.ebayMarketLastCalculatedAt,
      showEbayAvgPublicly: entity.showEbayAvgPublicly ?? false,
      profileFeatured: entity.profileFeatured ?? false,
      isProOnly: entity.isProOnly ?? false,
      proEarlyAccessUntil: entity.proEarlyAccessUntil ?? null,
      viewCount: Number(entity.viewCount ?? 0),
      watcherCount: Number(entity.watcherCount ?? 0),
      isWatching: opts.isWatching ?? false,
      saleType: entity.saleType,
      // Per-item shipping fee. Migrated existing rows default to $5
      // (see 20260423140000-AddItemShippingCost) so this is always set.
      shippingCostUsd: entity.shippingCostUsd
        ? Number(entity.shippingCostUsd)
        : 5,
      // In-person pickup flag. Defaults to false for legacy rows.
      isInPerson: entity.isInPerson ?? false,
      // Auction summary derived from the eager-loaded `auction` relation.
      // Per-user fields (isLeader / isBidder / currentUserProxyMaxUsd)
      // are populated when `auctionViewerUserId` is threaded through the
      // calling chain so listing endpoints render the correct CTA for
      // the current high bidder. Shipping is read off this prize so the
      // bidder modal can show an accurate "if I win" total.
      auction: entity.auction
        ? this.auctionsService.buildSummary(entity.auction, {
            userId: opts.auctionViewerUserId ?? undefined,
            isBidder: opts.auctionIsBidder ?? false,
            shippingCostUsd: entity.shippingCostUsd
              ? Number(entity.shippingCostUsd)
              : null,
          })
        : null,
    };
  }

  private parseNumeric(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed =
      typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(parsed) ? this.round2(parsed) : null;
  }

  private parseCount(value: unknown): number {
    if (value === null || value === undefined) {
      return 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  private round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private mapSoldListingToAdminDto(
    row: PrizeItemEbaySoldListing,
  ): AdminEbayMarketSoldListingDto {
    return {
      id: row.id,
      providerItemId: row.providerItemId,
      soldTitle: row.soldTitle,
      salePrice: this.parseNumeric(row.salePrice) ?? 0,
      currencySymbol: row.currencySymbol,
      dateSold: row.dateSold,
      imageUrl: row.imageUrl,
      listingUrl: row.listingUrl,
      itemCondition: row.itemCondition,
      buyingFormat: row.buyingFormat,
      shippingPrice: this.parseNumeric(row.shippingPrice),
      searchQuery: row.searchQuery ?? null,
      isInaccurate: row.isInaccurate,
      inaccurateReason: row.inaccurateReason,
      inaccurateFlaggedByUserId: row.inaccurateFlaggedByUserId,
      inaccurateFlaggedAt: row.inaccurateFlaggedAt,
    };
  }

  /**
   * Seller: bulk-update which items are profile-featured.
   * Accepts an array of item IDs to feature (max 10). All other seller items get un-featured.
   * Only PRO subscribers can use this.
   */
  async updateProfileFeaturedItems(
    sellerId: string,
    featuredItemIds: string[],
  ): Promise<{ featuredCount: number }> {
    await this.ensureSeller(sellerId);

    // Check PRO status
    const seller = await this.userRepository.findOne({
      where: { id: sellerId, isActive: true },
    });
    if (!seller?.isProSubscriber) {
      throw new ForbiddenException(
        'PRO subscription required to feature items on your profile',
      );
    }

    if (featuredItemIds.length > 10) {
      throw new ForbiddenException(
        'You can feature a maximum of 10 items on your profile',
      );
    }

    // Get all active seller items
    const allItems = await this.prizeConfigRepository.find({
      where: {
        createdBy: sellerId,
        isActive: true,
        showOnShop: true,
      },
    });

    // Validate all requested IDs belong to this seller
    const sellerItemIds = new Set(allItems.map((item) => item.id));
    for (const id of featuredItemIds) {
      if (!sellerItemIds.has(id)) {
        throw new ForbiddenException(
          `Item ${id} not found or does not belong to you`,
        );
      }
    }

    const featuredSet = new Set(featuredItemIds);

    // Un-feature items not in the new list
    const toUnfeature = allItems.filter(
      (item) => item.profileFeatured && !featuredSet.has(item.id),
    );
    if (toUnfeature.length > 0) {
      await this.prizeConfigRepository.update(
        toUnfeature.map((i) => i.id),
        { profileFeatured: false },
      );
    }

    // Feature items in the new list
    const toFeature = allItems.filter(
      (item) => !item.profileFeatured && featuredSet.has(item.id),
    );
    if (toFeature.length > 0) {
      await this.prizeConfigRepository.update(
        toFeature.map((i) => i.id),
        { profileFeatured: true },
      );
    }

    return { featuredCount: featuredItemIds.length };
  }
}
