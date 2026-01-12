import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrizeConfiguration } from './entities/prize-configuration.entity';
import { PrizeRedemption } from './entities/prize-redemption.entity';
import { User } from '../users/entities/user.entity';
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
} from './dto';

/**
 * Service for managing prize configuration and calculating user progress.
 * Implements data hardening: updates create new rows instead of modifying existing ones.
 */
@Injectable()
export class PrizeService {
  private readonly logger = new Logger(PrizeService.name);

  constructor(
    @InjectRepository(PrizeConfiguration)
    private readonly prizeConfigRepository: Repository<PrizeConfiguration>,
    @InjectRepository(PrizeRedemption)
    private readonly prizeRedemptionRepository: Repository<PrizeRedemption>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

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
    // Check if tier number is already active
    const existingTier = await this.prizeConfigRepository.findOne({
      where: { prizeTier: dto.prizeTier, isActive: true },
    });

    if (existingTier) {
      throw new ConflictException(
        `Prize tier ${dto.prizeTier} is already active. Please deactivate it first or use update.`,
      );
    }

    // Create new tier
    const newTier = this.prizeConfigRepository.create({
      prizeTier: dto.prizeTier,
      amount: dto.amount,
      name: dto.name,
      description: dto.description || null,
      imageUrl: dto.imageUrl || null,
      isActive: true,
      createdBy: userId,
      updatedBy: userId,
    });

    const saved = await this.prizeConfigRepository.save(newTier);
    this.logger.log(
      `Prize tier ${dto.prizeTier} created by user ${userId}. New ID: ${saved.id}`,
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

    // Validate that amounts are positive
    if (dto.amount <= 0) {
      throw new BadRequestException('Prize amount must be positive');
    }

    // Data hardening: Set old tier to inactive
    existingTier.isActive = false;
    await this.prizeConfigRepository.save(existingTier);

    // Create new tier with updated data and new UUID
    const newTier = this.prizeConfigRepository.create({
      prizeTier: dto.prizeTier,
      amount: dto.amount,
      name: dto.name,
      description: dto.description || null,
      imageUrl: dto.imageUrl || null,
      isActive: true,
      createdBy: userId,
      updatedBy: userId,
    });

    const saved = await this.prizeConfigRepository.save(newTier);
    this.logger.log(
      `Prize tier ${dto.prizeTier} updated by user ${userId}. Old ID: ${id}, New ID: ${saved.id}`,
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
      ? prizes.findIndex(p => p.amount === currentPrize.amount)
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
  async getUserRedemptions(userId: string): Promise<UserRedemptionResponseDto[]> {
    const redemptions = await this.prizeRedemptionRepository.find({
      where: { userId },
      relations: ['prizeConfiguration'],
      order: { dateRedeemed: 'DESC' },
    });

    return redemptions.map((r) => this.mapToUserRedemptionDto(r, r.prizeConfiguration));
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
      .leftJoinAndSelect('redemption.prizeConfiguration', 'prizeConfig');

    if (filterDto.status) {
      query.andWhere('redemption.shippingStatus = :status', { status: filterDto.status });
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
  async getAdminRedemptionById(id: string): Promise<AdminRedemptionResponseDto> {
    const redemption = await this.prizeRedemptionRepository.findOne({
      where: { id },
      relations: ['user', 'prizeConfiguration'],
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
    this.logger.log(`Redemption ${id} updated to status: ${dto.shippingStatus}`);

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
      prizeConfiguration: prizeConfig ? this.mapPrizeConfigToSummary(prizeConfig) : undefined,
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
    redemption: PrizeRedemption & { user?: User; prizeConfiguration?: PrizeConfiguration },
  ): AdminRedemptionResponseDto {
    return {
      ...this.mapRedemptionBaseFields(redemption),
      user: redemption.user ? this.mapUserWithAddress(redemption.user) : undefined,
      prizeConfiguration: redemption.prizeConfiguration 
        ? this.mapPrizeConfigToSummary(redemption.prizeConfiguration) 
        : undefined,
    };
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
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
    };
  }
}
