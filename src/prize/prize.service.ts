import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrizeConfiguration } from './entities/prize-configuration.entity';
import { PrizeRedemption } from './entities/prize-redemption.entity';
import { PrizeOrder } from './entities/prize-order.entity';
import { User } from '../users/entities/user.entity';
import { WalletsService } from '../wallets/wallets.service';
import { EmailsService } from '../emails/email.service';
import { CurrencyType } from '../enums/currency.enum';
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
  PrizeDisplayOrderUpdateDto,
} from './dto';
import { PrizeCategory } from './enums/prize-category.enum';
import { PrizePurchaseOption } from './enums/prize-purchase-option.enum';
import { PrizeBrand } from './enums/prize-brand.enum';

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
    @InjectRepository(PrizeRedemption)
    private readonly prizeRedemptionRepository: Repository<PrizeRedemption>,
    @InjectRepository(PrizeOrder)
    private readonly prizeOrderRepository: Repository<PrizeOrder>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly walletService: WalletsService,
    private readonly configService: ConfigService,
    private readonly emailsService: EmailsService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || '',
    );
  }

  /**
   * Get all active prize tiers, ordered by tier number.
   */
  async getActivePrizeTiers(): Promise<PrizeConfiguration[]> {
    const tiers = await this.prizeConfigRepository.find({
      where: { isActive: true },
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
   */
  async getPrizeConfiguration(): Promise<PrizeConfigurationDto[]> {
    const tiers = await this.getActivePrizeTiers();
    return tiers.map((tier) => this.mapToDto(tier));
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

  /**
   * Create a new prize tier (admin only).
   *
   * @param dto - Prize tier data
   * @param userId - Admin user ID making the change
   */
  async createPrizeTier(
    dto: CreatePrizeTierDto,
    userId: string,
  ): Promise<PrizeConfigurationDto> {
    // Auto-generate tier number if not provided
    let prizeTier = dto.prizeTier;
    if (!prizeTier) {
      // Get the highest tier number and add 1
      const maxTier = await this.prizeConfigRepository
        .createQueryBuilder('pc')
        .select('MAX(pc.prizeTier)', 'max')
        .getRawOne();

      prizeTier = (maxTier?.max || 0) + 1;
    } else {
      // If provided, check if tier number is already active
      const existingTier = await this.prizeConfigRepository.findOne({
        where: { prizeTier, isActive: true },
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

    // Auto-generate display orders for each page where item will be shown
    const category = (dto.category || 'slab') as 'slab' | 'sealed';
    
    let displayOrderShop = dto.displayOrderShop ?? null;
    if (!displayOrderShop && (dto.showOnShop ?? true)) {
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

    let displayOrderNicksNiceties = dto.displayOrderNicksNiceties ?? null;
    if (!displayOrderNicksNiceties && (dto.showOnNicksNiceties ?? true)) {
      const maxNicks = await this.prizeConfigRepository
        .createQueryBuilder('pc')
        .select('MAX(pc.displayOrderNicksNiceties)', 'max')
        .where('pc.category = :category', { category })
        .andWhere('pc.isActive = :isActive', { isActive: true })
        .getRawOne();
      displayOrderNicksNiceties = (maxNicks?.max || 0) + 1;
    }

    // Auto-generate featured display order if featured checkbox is true
    let featuredDisplayOrder = dto.featuredDisplayOrder ?? null;
    if (!featuredDisplayOrder && dto.featuredDisplayOrder !== null) {
      const maxFeatured = await this.prizeConfigRepository
        .createQueryBuilder('pc')
        .select('MAX(pc.featuredDisplayOrder)', 'max')
        .where('pc.isActive = :isActive', { isActive: true })
        .getRawOne();
      featuredDisplayOrder = (maxFeatured?.max || 0) + 1;
    }

    // Create new tier
    const newTier = this.prizeConfigRepository.create({
      prizeTier,
      amount,
      name: dto.name,
      description: dto.description || null,
      imageUrl: dto.imageUrl || null,
      category,
      stock: dto.stock ?? 0,
      purchaseOption,
      brand: dto.brand || PrizeBrand.POKEMON,
      displayOrderShop,
      displayOrderRedemptions,
      displayOrderNicksNiceties,
      featuredDisplayOrder,
      showOnRedemptions: dto.showOnRedemptions ?? true,
      showOnNicksNiceties: dto.showOnNicksNiceties ?? true,
      showOnShop: dto.showOnShop ?? true,
      isActive: true,
      createdBy: userId,
      updatedBy: userId,
    });

    const saved = await this.prizeConfigRepository.save(newTier);
    this.logger.log(
      `Prize tier ${prizeTier} created by user ${userId}. New ID: ${saved.id}`,
    );

    return this.mapToDto(saved);
  }

  /**
   * Update prize tier (admin only).
   * Implements data hardening: deactivates old tier and creates new one.
   *
   * @param id - ID of the tier to update
   * @param dto - Updated prize tier data
   * @param userId - Admin user ID making the change
   */
  async updatePrizeTier(
    id: string,
    dto: UpdatePrizeTierDto,
    userId: string,
  ): Promise<PrizeConfigurationDto> {
    // Find existing tier
    const existingTier = await this.getPrizeTierById(id);

    if (!existingTier.isActive) {
      throw new BadRequestException(
        'Cannot update an inactive prize tier. Please create a new one instead.',
      );
    }

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

    // Data hardening: Set old tier to inactive
    existingTier.isActive = false;
    await this.prizeConfigRepository.save(existingTier);

    // Create new tier with updated data and new UUID
    const newTier = this.prizeConfigRepository.create({
      prizeTier: dto.prizeTier ?? existingTier.prizeTier,
      amount,
      name: dto.name,
      description: dto.description || null,
      imageUrl: dto.imageUrl || null,
      category: (dto.category || existingTier.category) as 'slab' | 'sealed',
      stock: dto.stock ?? existingTier.stock,
      purchaseOption: dto.purchaseOption || existingTier.purchaseOption,
      brand: dto.brand || existingTier.brand,
      displayOrderShop: dto.displayOrderShop ?? existingTier.displayOrderShop,
      displayOrderRedemptions: dto.displayOrderRedemptions ?? existingTier.displayOrderRedemptions,
      displayOrderNicksNiceties: dto.displayOrderNicksNiceties ?? existingTier.displayOrderNicksNiceties,
      featuredDisplayOrder: dto.featuredDisplayOrder ?? existingTier.featuredDisplayOrder,
      showOnRedemptions: dto.showOnRedemptions ?? existingTier.showOnRedemptions,
      showOnNicksNiceties: dto.showOnNicksNiceties ?? existingTier.showOnNicksNiceties,
      showOnShop: dto.showOnShop ?? existingTier.showOnShop,
      isActive: true,
      createdBy: userId,
      updatedBy: userId,
    });

    const saved = await this.prizeConfigRepository.save(newTier);
    this.logger.log(
      `Prize tier ${dto.prizeTier ?? existingTier.prizeTier} updated by user ${userId}. Old ID: ${id}, New ID: ${saved.id}`,
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
      prize.displayOrderNicksNiceties = update.displayOrderNicksNiceties;
      prize.featuredDisplayOrder = update.featuredDisplayOrder;
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

    // Create the order with shipping fee added to total
    const order = this.prizeOrderRepository.create({
      userId,
      prizeConfigurationId: dto.prizeConfigId,
      shippingAddress: dto.shippingAddress,
      paymentMethod: dto.paymentMethod,
      coinsDeducted: dto.coinsAmount,
      usdCharged: parseFloat((dto.usdAmount + SHIPPING_FEE).toString()),
      totalPrice: parseFloat((dto.totalPrice + SHIPPING_FEE).toString()),
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
        const usdCents = Math.round(dto.usdAmount * 100);

        const session = await this.stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `${prize.name} Prize Purchase`,
                  description:
                    dto.paymentMethod === 'combined'
                      ? `${dto.coinsAmount} CadeCoins + $${dto.usdAmount.toFixed(2)} USD`
                      : `$${dto.usdAmount.toFixed(2)} USD`,
                },
                unit_amount: usdCents,
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          customer_email: user.email,
          success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/prizes?status=success&orderId=${savedOrder.id}`,
          cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/prizes?status=cancel&orderId=${savedOrder.id}`,
          metadata: {
            orderId: savedOrder.id,
            userId,
            prizeId: dto.prizeConfigId,
            paymentMethod: dto.paymentMethod,
            coinsAmount: dto.coinsAmount.toString(),
          },
        });

        // Save Stripe session ID to order
        savedOrder.stripeSessionId = session.id;
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
   * Handle Stripe checkout success and deduct coins if combined payment
   */
  async handlePaymentSuccess(orderId: string): Promise<PrizeOrderResponseDto> {
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

    return this.mapOrderToDto(updated);
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

    // Send email notification to admin
    try {
      const adminEmail =
        this.configService.get<string>('ADMIN_EMAIL') || 'admin@cardcade.io';
      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );
      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [adminEmail],
          subject: `💰 New Prize Offer: ${prize.name}`,
          params: {
            orderId: saved.id,
            userId,
            prizeName: prize.name,
            offerAmount: dto.offerAmount,
            notes: dto.offerNotes || '',
            adminUrl: frontendUrl,
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
    const amountToCharge =
      wasCountered && order.counterOfferAmount
        ? order.counterOfferAmount
        : order.offerAmount || order.totalPrice;

    order.status = 'offer_accepted';
    const updated = await this.prizeOrderRepository.save(order);

    // Create Stripe checkout session
    const prize = await this.getPrizeTierById(order.prizeConfigurationId);

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${prize.name} - Accepted Offer`,
              description: `Offer accepted at $${amountToCharge}`,
            },
            unit_amount: Math.round(amountToCharge * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/prizes?status=success&orderId=${order.id}`,
      cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/prizes?status=cancel&orderId=${order.id}`,
      metadata: {
        orderId: order.id,
        userId: order.userId,
        type: 'prize_offer',
      },
    });

    // Save Stripe session ID
    order.stripeSessionId = session.id;
    order.usdCharged = amountToCharge;
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
    const amountToCharge = order.counterOfferAmount || order.totalPrice;

    // Create Stripe checkout session
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${prize.name} - Counter Offer Accepted`,
              description: `Counter offer accepted at $${amountToCharge}`,
            },
            unit_amount: Math.round(amountToCharge * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/prizes?status=success&orderId=${order.id}`,
      cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/prizes?status=cancel&orderId=${order.id}`,
      metadata: {
        orderId: order.id,
        userId: order.userId,
        type: 'prize_counter_offer',
      },
    });

    // Update order with Stripe session
    order.stripeSessionId = session.id;
    order.usdCharged = amountToCharge;
    order.status = 'offer_accepted';
    await this.prizeOrderRepository.save(order);

    return { stripeSessionUrl: session.url || '' };
  }

  /**
   * Map entity to DTO
   */
  private mapToDto(entity: PrizeConfiguration): PrizeConfigurationDto {
    return {
      id: entity.id,
      prizeTier: entity.prizeTier,
      amount: Number(entity.amount),
      name: entity.name,
      description: entity.description,
      imageUrl: entity.imageUrl,
      category: entity.category,
      stock: entity.stock,
      purchaseOption: entity.purchaseOption,
      brand: entity.brand,
      displayOrderShop: entity.displayOrderShop,
      displayOrderRedemptions: entity.displayOrderRedemptions,
      displayOrderNicksNiceties: entity.displayOrderNicksNiceties,
      featuredDisplayOrder: entity.featuredDisplayOrder,
      showOnRedemptions: entity.showOnRedemptions,
      showOnNicksNiceties: entity.showOnNicksNiceties,
      showOnShop: entity.showOnShop,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
    };
  }
}
