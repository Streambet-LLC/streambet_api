import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrizeConfiguration } from './entities/prize-configuration.entity';
import { PrizeRedemption } from './entities/prize-redemption.entity';
import { PrizeOrder } from './entities/prize-order.entity';
import { ItemConfigurationImage } from './entities/item-configuration-image.entity';
import { ShopSettings } from './entities/shop-settings.entity';
import { User } from '../users/entities/user.entity';
import { WalletsService } from '../wallets/wallets.service';
import { EmailsService } from '../emails/email.service';
import { CurrencyType } from '../enums/currency.enum';
import { TransactionType } from '../enums/transaction-type.enum';
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
  MakeOfferDto,
  CounterOfferDto,
  MarkAsShippedDto,
  PrizeDisplayOrderUpdateDto,
  UpdateShopSettingsDto,
} from './dto';
import { PrizeCategory } from './enums/prize-category.enum';
import { PrizePurchaseOption } from './enums/prize-purchase-option.enum';
import { PrizeBrand } from './enums/prize-brand.enum';
import { stripe } from 'src/integrations/stripe';
import {
  BUYER_PROCESSING_FEE_PERCENT,
  calculateBuyerItemFeeCents,
  calculateRewardCadeCoinsFromCents,
  calculateSellerFeeCents,
  getEffectiveSellerFeePercent,
} from 'src/common/utils/fee-utils';

/**
 * Service for managing prize configuration and calculating user progress.
 * Implements data hardening: updates create new rows instead of modifying existing ones.
 */
@Injectable()
export class PrizeService {
  private readonly logger = new Logger(PrizeService.name);
  private stripe: Stripe;

  constructor(
    @InjectRepository(PrizeConfiguration)
    private readonly prizeConfigRepository: Repository<PrizeConfiguration>,
    @InjectRepository(ItemConfigurationImage)
    private readonly itemImageRepository: Repository<ItemConfigurationImage>,
    @InjectRepository(PrizeRedemption)
    private readonly prizeRedemptionRepository: Repository<PrizeRedemption>,
    @InjectRepository(PrizeOrder)
    private readonly prizeOrderRepository: Repository<PrizeOrder>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ShopSettings)
    private readonly shopSettingsRepository: Repository<ShopSettings>,
    private readonly walletService: WalletsService,
    private readonly configService: ConfigService,
    private readonly emailsService: EmailsService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || '',
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
      relations: ['itemImages'],
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
      });
      return defaults;
    }

    throw new NotFoundException(`Shop settings not found for key: ${shopKey}`);
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

    return this.shopSettingsRepository.save(settings);
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
    }>
  > {
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
      .groupBy('u.id')
      .addGroupBy('COALESCE(u.shop_name, u.name, u.username)')
      .addGroupBy('u.profile_image_url');

    if (limit) {
      qb.orderBy('RANDOM()').limit(limit);
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

    const result = [
      {
        id: 0,
        username: 'cardcade',
        displayName: cardcadeSettings.displayName || 'CardCade Shop',
        profileImageUrl: cardcadeSettings.profileImageUrl || null,
        itemCount: 10,
      },
      ...rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.displayName || row.username,
        profileImageUrl: row.profileImageUrl || null,
        itemCount: Number(row.itemCount || 0),
      })),
    ];

    return result;
  }

  /**
   * Public: get all shop items across all sellers.
   * This is for the main "Shop" page in the navbar, showing all available shop items.
   */
  async getAllShopItems(): Promise<PrizeConfigurationDto[]> {
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
      relations: ['creator', 'itemImages'],
      order: {
        displayOrderShop: 'ASC',
        createdAt: 'DESC',
      },
    });

    this.logger.log(
      `[SHOP] Found ${sellerItems.length} active shop items`,
    );
    this.logger.debug(
      `[SHOP] Items breakdown: ${JSON.stringify(sellerItems.map((i) => ({ id: i.id, name: i.name, stock: i.stock, createdBy: i.createdBy })))}`,
    );

    return sellerItems.map((item) => this.mapToDto(item));
  }

  /**
   * Public: get one seller shop and its active items.
   */
  async getPublicShopByUsername(username: string): Promise<{
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
        relations: ['itemImages'],
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
        } as ShopSettings;
      }

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
        items: sortedSellerItems.map((item) => this.mapToDto(item)),
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
        relations: ['itemImages'],
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
        items: sortedSellerItems.map((item) => this.mapToDto(item)),
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
      relations: ['itemImages'],
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

    const { displayOrderShop, sellerDisplayOrderShop, ...restDto } = dto;
    const sellerScopedDisplayOrder = sellerDisplayOrderShop ?? displayOrderShop;

    return this.createPrizeTier(
      {
        ...restDto,
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

    const { displayOrderShop, sellerDisplayOrderShop, ...restDto } = dto;
    const sellerScopedDisplayOrder = sellerDisplayOrderShop ?? displayOrderShop;

    return this.updatePrizeTier(
      itemId,
      {
        ...restDto,
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
    if (imageUrls.length > 7) {
      throw new BadRequestException('A maximum of 7 item images is allowed');
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
    const category = (dto.category || 'slab') as 'slab' | 'sealed';
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
    const newTier = this.prizeConfigRepository.create({
      prizeTier,
      amount,
      name: dto.name,
      description: dto.description || null,
      imageUrl: coverImageUrl,
      coverImageId: null,
      category,
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
      category: (dto.category || existingTier.category) as 'slab' | 'sealed',
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
    if (prize.purchaseOption === PrizePurchaseOption.OFFERS_ONLY) {
      throw new BadRequestException(
        'This prize is offer-only and cannot be purchased directly',
      );
    }

    const isSellerOwnedItem = await this.isSellerOwnedItem(prize);
    if (isSellerOwnedItem && dto.paymentMethod !== 'usd') {
      throw new BadRequestException(
        'Seller shop items are USD-only. CadeCoins are not accepted for this item.',
      );
    }

    const SHIPPING_FEE = 5; // $5 shipping fee

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
        const subtotalCents = Math.round(dto.usdAmount * 100);

        // Load seller to check for Stripe Connect account and application fee
        const seller = prize.createdBy
          ? await this.userRepository.findOne({
            where: { id: prize.createdBy },
            relations: ['wallet'],
          })
          : null;

        // Buyer fee applies to item subtotal only (shipping excluded).
        const shippingCents = Math.round(SHIPPING_FEE * 100);
        const buyerFeeCents = calculateBuyerItemFeeCents(
          subtotalCents,
          shippingCents,
        );
        const totalChargeCents = subtotalCents + buyerFeeCents;

        const sessionParams = {
          payment_method_types: ['card'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
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
          success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}purchase-success?orderId=${savedOrder.id}`,
          cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}shop?status=cancel&orderId=${savedOrder.id}`,
          metadata: {
            orderId: savedOrder.id,
            userId,
            prizeId: dto.prizeConfigId,
            paymentMethod: dto.paymentMethod,
            coinsAmount: dto.coinsAmount.toString(),
            transactionSubtotalCents: subtotalCents.toString(),
            buyerFeeCents: buyerFeeCents.toString(),
          },
        };

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
   * Handle Stripe checkout success and deduct coins if combined payment
   */
  async handlePaymentSuccess(
    orderId: string,
    transactionSubtotalCents?: number,
  ): Promise<PrizeOrderResponseDto> {
    const order = await this.getPrizeOrderById(orderId);

    if (order.status === 'paid') {
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

    // Mark order as paid
    order.status = 'paid';
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

    this.logger.log(`Order ${orderId} marked as paid after Stripe success`);

    // Send notification emails
    try {
      await this.sendSellerShopPurchaseNotification(updated, prize, order.user);
    } catch (error) {
      this.logger.error(
        `Failed to send seller notification email for order ${orderId}:`,
        error,
      );
    }

    try {
      await this.sendBuyerShopPurchaseNotification(updated, prize, order.user);
    } catch (error) {
      this.logger.error(
        `Failed to send buyer notification email for order ${orderId}:`,
        error,
      );
    }

    return this.mapOrderToDto(updated);
  }

  private async sendSellerShopPurchaseNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
  ): Promise<void> {
    // Only send if this is a seller-owned item
    if (!prize.createdBy) {
      return;
    }

    const seller = await this.userRepository.findOne({
      where: { id: prize.createdBy },
    });

    if (!seller || !seller.email) {
      this.logger.warn(
        `Seller ${prize.createdBy} not found or has no email for order ${order.id}`,
      );
      return;
    }

    try {
      // Show the seller the amount without the buyer service fee
      const BUYER_FEE_PERCENT = BUYER_PROCESSING_FEE_PERCENT;
      const charged = parseFloat(order.usdCharged?.toString() || '0');
      const sellerVisibleAmount = charged > 0
        ? parseFloat((charged / (1 + BUYER_FEE_PERCENT / 100)).toFixed(2))
        : order.totalPrice;

      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );
      const markShippedUrl = `${frontendUrl}/seller/shop/manage?tab=orders&orderId=${order.id}`;
      const shipping: PrizeOrder['shippingAddress'] = order.shippingAddress || {
        addressLine1: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
      };

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [seller.email],
          subject: `New Sale! ${prize.name} has been purchased 🎉`,
          params: {
            sellerName: seller.name || seller.username,
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
            shippingAddressLine1: shipping.addressLine1 || '',
            shippingAddressLine2: shipping.addressLine2 || '',
            shippingCity: shipping.city || '',
            shippingState: shipping.state || '',
            shippingZipCode: shipping.zipCode || '',
            shippingCountry: shipping.country || '',
            markShippedUrl,
          },
        },
        'seller_shop_purchase',
      );
      this.logger.log(
        `Seller shop purchase notification sent to ${seller.email} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send seller shop purchase email for order ${order.id}:`,
        emailError,
      );
    }
  }

  private async sendBuyerShopPurchaseNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
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

  private async ensureRedemptionForOrder(
    order: PrizeOrder,
    prize: PrizeConfiguration,
  ): Promise<void> {
    let prizeCategory: PrizeCategory = PrizeCategory.SLAB;
    if (prize.category === 'sealed') {
      prizeCategory = PrizeCategory.SEALED;
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
      relations: ['prizeConfiguration'],
      order: { createdAt: 'DESC' },
    });

    return orders.map((order) => this.mapOrderToDto(order));
  }

  async getShopOrders(userId: string): Promise<PrizeOrderResponseDto[]> {
    const orders = await this.prizeOrderRepository.find({
      where: {
        prizeConfiguration: {
          createdBy: userId,
        },
      },
      relations: ['prizeConfiguration', 'user'],
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
          }
        : undefined,
      prizeConfig: order.prizeConfiguration
        ? {
            name: order.prizeConfiguration.name,
            category: order.prizeConfiguration.category,
            image: order.prizeConfiguration.imageUrl ?? '',
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
    if (prize.purchaseOption === PrizePurchaseOption.BUY_ONLY) {
      throw new BadRequestException(
        'This prize is buy-only and does not accept offers',
      );
    }

    const SHIPPING_FEE = 5; // $5 shipping fee
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
        this.configService.get<string>('ADMIN_EMAIL') || 'admin@cardcade.io';
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
    const SHIPPING_FEE = 5;
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
    const prize = await this.getPrizeTierById(order.prizeConfigurationId);

    const offerAmountCents = Math.round(amountToCharge * 100);

    // Load seller to check for Stripe Connect account and application fee
    const offerSeller = prize.createdBy
      ? await this.userRepository.findOne({
        where: { id: prize.createdBy },
        relations: ['wallet'],
      })
      : null;

    // Buyer fee applies to item subtotal only (shipping excluded).
    const offerShippingCents = Math.round(SHIPPING_FEE * 100);
    const buyerFeeCents = calculateBuyerItemFeeCents(
      offerAmountCents,
      offerShippingCents,
    );
    const totalChargeCents = offerAmountCents + buyerFeeCents;

    const acceptOfferSessionParams = {
      payment_method_types: ['card'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
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
      success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}purchase-success?orderId=${order.id}`,
      cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}shop?status=cancel&orderId=${order.id}`,
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
    const SHIPPING_FEE = 5;
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
    const counterOfferShippingCents = Math.round(SHIPPING_FEE * 100);
    const buyerFeeCents = calculateBuyerItemFeeCents(
      counterOfferAmountCents,
      counterOfferShippingCents,
    );
    const totalChargeCents = counterOfferAmountCents + buyerFeeCents;

    // Create Stripe checkout session
    const counterOfferSessionParams = {
      payment_method_types: [
        'card',
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
      success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}purchase-success?orderId=${order.id}`,
      cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}shop?status=cancel&orderId=${order.id}`,
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
        `Transaction reward for order ${order.id}`,
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
        `Transaction reward for sale ${order.id}`,
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
   * Map entity to DTO
   */
  private mapToDto(entity: PrizeConfiguration): PrizeConfigurationDto {
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
      updatedBy: entity.updatedBy,
    };
  }
}
