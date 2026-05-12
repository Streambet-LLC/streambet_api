import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Not, Or, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcrypt';
import {
  NotificationSettingsUpdateDto,
  ProfileUpdateDto,
  UserFilterDto,
  UserUpdateDto,
} from './dto/user.requests.dto';
import { UserResponseDto, PublicUserProfileDto } from './dto/user.response.dto';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { MAX_CADE_COINS_FOR_BETTING } from 'src/common/constants/currency.constants';
import { UserRole } from 'src/enums/user-role.enum';
import { Follower } from 'src/follower/follower.entity';
import { PrizeService } from 'src/prize/prize.service';
import { Transaction } from 'src/wallets/entities/transaction.entity';
import { CurrencyType } from 'src/enums/currency.enum';
import { TransactionType } from 'src/enums/transaction-type.enum';
import { getEffectiveSellerFeePercent } from 'src/common/utils/fee-utils';
import { ConfigService } from '@nestjs/config';
import { QueueService } from 'src/queue/queue.service';
import { EmailType } from 'src/enums/email-type.enum';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Follower)
    private readonly followerRepository: Repository<Follower>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly prizeService: PrizeService,
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Notify the CardCade admin inbox that a new seller has completed
   * the in-app questionnaire and been auto-promoted. Stripe Connect
   * onboarding is tracked separately and may still be pending.
   */
  private async notifyAdminOfNewSeller(user: User, shopName: string) {
    try {
      const adminEmail =
        this.configService.get<string>('ADMIN_EMAIL') || 'contact@cardcade.fun';
      if (!adminEmail) return;
      if (user.email && user.email.indexOf('@example.com') !== -1) {
        return;
      }
      const host = (
        this.configService.get<string>('email.HOST_URL') ||
        this.configService.get<string>('APP_HOST_URL') ||
        ''
      ).replace(/\/$/, '');
      const shopLink = `${host}/shop/${user.username}`;
      const adminUserLink = `${host}/admin/users/${user.id}`;

      await this.queueService.addEmailJob(
        {
          toAddress: [adminEmail],
          subject: `New CardCade seller: ${user.username}`,
          params: {
            username: user.username || '',
            email: user.email || '',
            shopName,
            shopLink,
            adminUserLink,
            signupDate: new Date().toISOString(),
          },
        } as never,
        EmailType.NewSellerSignup,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to dispatch new_seller_signup admin email for ${user.username}: ${
          (err as Error)?.message
        }`,
      );
    }
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      order: { createdAt: 'DESC' },
    });
  }
  /**
   * Retrieves a user by their ID.
   * @param id - The ID of the user to retrieve.
   * @returns The user details or throws NotFoundException if not found.
   */
  async findOne(id: string): Promise<UserResponseDto> {
    try {
      const user = await this.usersRepository.findOne({
        where: { id },
        relations: ['wallet'],
      });
      if (!user) {
        throw new NotFoundException(
          `we couldn't find a user matching that information`,
        );
      }

      const { password: _unused, wallet, ...sanitizedUser } = user;
      const result = {
        ...sanitizedUser,
        maxCadeCoinsBet: MAX_CADE_COINS_FOR_BETTING,
        walletBalanceCadeCoin: Number(user.wallet?.cadeCoins ?? 0),
      };
      // Exclude password from the response
      return result;
    } catch (e) {
      this.logger.error(`Error finding user with ID ${id}:`, e);
      throw new NotFoundException((e as Error).message);
    }
  }
  /**
   * Retrieves a user with address fields by their ID.
   * Used for secure endpoints that need access to address data.
   * @param id - The ID of the user to retrieve.
   * @returns The user entity with address fields or throws NotFoundException if not found.
   */
  async findOneWithAddress(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id },
    });
    if (!user) {
      throw new NotFoundException(
        `we couldn't find a user matching that information`,
      );
    }
    return user;
  }
  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async findByEmailOrUsername(identifier: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: [{ email: ILike(identifier) }, { username: ILike(identifier) }],
    });
  }
  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { username: ILike(username) },
    });
  }

  async findByRefreshToken(refreshToken: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { refreshToken },
    });
  }

  /**
   * Finds a user by their unique userId.
   *
   * @param userId - The unique identifier of the user
   * @returns The found user object if it exists
   * @throws NotFoundException if the user does not exist
   * @throws InternalServerErrorException if any unexpected error occurs
   */
  async findUserByUserId(userId: string): Promise<User> {
    try {
      // Attempt to find the user in the database by ID
      const user = await this.usersRepository.findOne({
        where: { id: userId },
      });

      // If no user is found, throw a NotFoundException
      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }

      // Return the found user
      return user;
    } catch (error) {
      // If the error is already a NotFoundException, rethrow it
      if (error instanceof NotFoundException) {
        throw error;
      }

      // Handle any other unexpected errors gracefully
      this.logger.log(`FindUserByUserId -${error}`);
      throw new InternalServerErrorException(
        `Failed to retrieve user with ID ${userId}`,
      );
    }
  }

  async softDeleteUser(userId: string): Promise<User> {
    const user = await this.findUserByUserId(userId);
    const timestamp = Date.now();
    const suffix = `_del_${timestamp}`;
    // Preserve domain by appending suffix into the local-part
    let updatedEmail: string;
    if (user.email?.includes('@')) {
      const [local, domain] = user.email.split('@');
      updatedEmail = `${local}${suffix}@${domain}`;
    } else {
      updatedEmail = `${user.email ?? 'user'}${suffix}`;
    }
    // Username fallback if nullish
    const updatedUsername = `${user.username ?? 'user'}${suffix}`;

    // Set deletion fields
    user.email = updatedEmail;
    user.username = updatedUsername;
    user.deletedAt = new Date();
    // Deactivate and invalidate tokens immediately
    user.isActive = false;
    user.refreshToken = null;
    user.refreshTokenExpiresAt = null;

    // Save the updated user
    return this.usersRepository.save(user);
  }

  async create(userData: Partial<User>): Promise<User> {
    const user = this.usersRepository.create(userData);
    return this.usersRepository.save(user);
  }

  async update(id: string, userData: Partial<User>): Promise<UserResponseDto> {
    await this.usersRepository.update({ id }, userData);
    return this.findOne(id);
  }

  async profileUpdate(
    id: string,
    profileUpdateDto: ProfileUpdateDto,
  ): Promise<UserResponseDto> {
    try {
      const existingUserObj = await this.usersRepository.findOne({
        where: { id },
      });
      if (!existingUserObj) {
        throw new NotFoundException('User not found');
      }
      if (profileUpdateDto?.newPassword) {
        if (profileUpdateDto?.currentPassword) {
          if (
            profileUpdateDto?.currentPassword === profileUpdateDto?.newPassword
          ) {
            throw new NotFoundException(
              'Old password and new password cannot be the same',
            );
          }
          const isCurrentPasswordValid = await bcrypt.compare(
            profileUpdateDto.currentPassword,
            existingUserObj.password,
          );
          if (!isCurrentPasswordValid) {
            throw new NotFoundException('Old password is incorrect');
          }
          const salt = await bcrypt.genSalt();
          const hashedNewPassword = await bcrypt.hash(
            profileUpdateDto.newPassword,
            salt,
          );
          profileUpdateDto.password = hashedNewPassword;
          delete profileUpdateDto.currentPassword;
          delete profileUpdateDto.newPassword;
        } else {
          throw new NotFoundException(
            'Old password is required to update the password',
          );
        }
      }
      if (profileUpdateDto?.username) {
        const existingUserWithUsername = await this.findByUsername(
          profileUpdateDto.username,
        );
        if (existingUserWithUsername && existingUserWithUsername.id !== id) {
          throw new NotFoundException(
            'Username already exists. Please choose a different username.',
          );
        }
      }
      // Allow any user to save their own socials
      this.logger.log(
        `[PROFILE UPDATE] User ${existingUserObj?.username} - Role: ${existingUserObj?.role}, IsSeller: ${existingUserObj?.isSeller}`,
      );
      this.logger.log(
        `[PROFILE UPDATE] ProfileUpdateDto socials before filter: ${JSON.stringify(profileUpdateDto.socials)}`,
      );
      // Don't delete socials - allow all users to have them
      this.logger.log(
        `[PROFILE UPDATE] Keeping socials - allowing all users to save socials`,
      );
      this.logger.log(
        `[PROFILE UPDATE] ProfileUpdateDto socials after filter: ${JSON.stringify(profileUpdateDto.socials)}`,
      );

      // Auto-promote to seller when the user finishes the in-app
      // questionnaire. We only flip on the false → true transition so
      // editing other profile fields after the fact never triggers it.
      let justBecameSeller = false;
      let promotedShopName: string | undefined;
      if (
        profileUpdateDto.sellerProfileCompleted === true &&
        !existingUserObj.sellerProfileCompleted
      ) {
        if (!existingUserObj.isSeller) {
          (profileUpdateDto as Partial<User>).isSeller = true;
        }
        // Default the shop name so the marketplace has something to render
        // before the user customizes it.
        if (!existingUserObj.shopName && !profileUpdateDto.shopName) {
          (profileUpdateDto as Partial<User>).shopName =
            `${existingUserObj.username}'s Shop`;
        }
        promotedShopName =
          profileUpdateDto.shopName ||
          existingUserObj.shopName ||
          `${existingUserObj.username}'s Shop`;
        justBecameSeller = true;
        this.logger.log(
          `[PROFILE UPDATE] Auto-promoting user ${existingUserObj.username} (${id}) to seller via questionnaire`,
        );
      }

      await this.usersRepository.update({ id }, profileUpdateDto);

      if (justBecameSeller) {
        // Fire-and-forget; failure is logged inside the helper.
        void this.notifyAdminOfNewSeller(
          existingUserObj,
          promotedShopName ?? `${existingUserObj.username}'s Shop`,
        );
      }

      return this.findOne(id);
    } catch (e) {
      this.logger.error(`Error updating profile for user with ID ${id}:`, e);
      throw new NotFoundException((e as Error).message);
    }
  }

  async followUser(
    followerId: string,
    followedUsername: string,
  ): Promise<void> {
    const followedUser = await this.usersRepository.findOne({
      where: {
        username: followedUsername,
      },
    });

    if (followedUser) {
      const hasFollowed = await this.followerRepository.count({
        where: {
          followedUuid: followedUser.id,
          followerUuid: followerId,
        },
      });

      if (hasFollowed === 0) {
        await this.followerRepository
          .create({
            followedUuid: followedUser.id,
            followerUuid: followerId,
          })
          .save();
      }
    }
  }

  async unfollowUser(
    follower: string,
    followedUsername: string,
  ): Promise<void> {
    const followedUser = await this.usersRepository.findOne({
      where: {
        username: followedUsername,
      },
    });

    if (followedUser) {
      await this.followerRepository.delete({
        followerUuid: follower,
        followedUuid: followedUser.id,
      });
    }
  }

  async getUserProfile(
    requestor: string | null,
    username: string,
  ): Promise<PublicUserProfileDto> {
    try {
      const user = await this.usersRepository.findOne({
        where: {
          username,
          isActive: true,
          isBanned: Or(Not(true), IsNull()),
          isSuspended: Or(Not(true), IsNull()),
        },
        relations: ['wallet'],
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Get follower information
      let isFollowed = false;
      const followers = await this.followerRepository.count({
        where: {
          followedUuid: user.id,
        },
      });

      if (requestor) {
        const hasFollowed = await this.followerRepository.count({
          where: {
            followedUuid: user.id,
            followerUuid: requestor,
          },
        });

        isFollowed = hasFollowed > 0;
      }

      // Get prize information based on lifetime coins using PrizeService
      const lifetimeCoins = Number(user.wallet?.lifetimeCoinsEarned ?? 0);
      let prizeData = null;

      try {
        prizeData = await this.prizeService.getPrizeInfo(lifetimeCoins);
      } catch (error) {
        // Silently handle missing prize data - prize fields will be omitted from response
      }

      // Get listed item count for sellers
      const listedItemCount = user.isSeller
        ? await this.prizeService.getSellerListedItemCount(user.id)
        : 0;

      // Base response combining both follower and gamification features
      const response: PublicUserProfileDto = {
        id: user.id,
        username: user.username,
        name: user.name,
        accountCreationDate: user.accountCreationDate,
        profileImageUrl: user.profileImageUrl,
        socials: user.socials,
        role: user.role,
        // Follower data
        isFollowed,
        followers,
        // Gamification data for ALL roles
        currentCadeCoins: Number(user.wallet?.cadeCoins || 0),
        lifetimeCadeCoins: lifetimeCoins,
        ...(prizeData && {
          title: prizeData.title,
          badgeLevel: prizeData.badgeLevel,
          prizeProgress: prizeData.prizeProgress,
        }),
        ...(user.collectionPreferences &&
          user.collectionPreferences.length > 0 && {
            collectionPreferences: user.collectionPreferences,
          }),
        ...(user.city && { city: user.city }),
        ...(user.state && { state: user.state }),
        ...(user.country && { country: user.country }),
        ...(user.isSeller && {
          isSeller: true,
          listedItemCount,
        }),
        ...(user.isProSubscriber && {
          isProSubscriber: true,
        }),
        ...(user.auctionsEnabled && {
          auctionsEnabled: true,
        }),
        // Include effective seller fee only when viewing own profile
        ...(user.isSeller &&
          requestor === user.id && {
            effectiveSellerFeePercent: getEffectiveSellerFeePercent({
              lifetimeCadeCoins: lifetimeCoins,
              adminFeeOverridePercent:
                user.adminFeeOverridePercent !== null &&
                user.adminFeeOverridePercent !== undefined
                  ? Number(user.adminFeeOverridePercent)
                  : null,
            }),
          }),
      };

      return response;
    } catch (e) {
      this.logger.error(
        `Error fetching profile for user with username ${username}:`,
        e,
      );
      throw new NotFoundException((e as Error).message);
    }
  }

  async getCreators(): Promise<
    Pick<UserResponseDto, 'username' | 'name' | 'profileImageUrl'>[]
  > {
    try {
      const creators = await this.usersRepository.find({
        where: {
          role: UserRole.CREATOR,
          isActive: true,
          isBanned: Or(Not(true), IsNull()),
          isSuspended: Or(Not(true), IsNull()),
        },
        select: ['username', 'name', 'profileImageUrl'],
      });

      return creators;
    } catch (e) {
      this.logger.error(`Error fetching creators`, e);
      throw new NotFoundException((e as Error).message);
    }
  }

  async findAllUser(
    userFilterDto: UserFilterDto,
  ): Promise<{ data: any[]; total: number }> {
    const sort: Sort = userFilterDto.sort
      ? (JSON.parse(userFilterDto.sort) as Sort)
      : undefined;

    const filter: FilterDto = userFilterDto.filter
      ? (JSON.parse(userFilterDto.filter) as FilterDto)
      : undefined;
    const range: Range = userFilterDto.range
      ? (JSON.parse(userFilterDto.range) as Range)
      : [0, 10];
    const { pagination = true } = userFilterDto;

    const usersQB = this.usersRepository
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.wallet', 'wallet');

    // Filtering by query string (username or email)
    if (filter.q) {
      usersQB.andWhere(
        `(LOWER(u.username) ILIKE LOWER(:q) OR LOWER(u.email) ILIKE LOWER(:q))`,
        { q: `%${filter.q}%` },
      );
    }

    // Sorting logic
    if (sort) {
      const [sortColumn, sortOrder] = sort;
      usersQB.orderBy(
        `u.${sortColumn}`,
        sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
      );
    }
    usersQB.andWhere('u.deleted_at IS  NULL');
    // Count before applying pagination
    const total = await usersQB.getCount();

    // Pagination logic
    if (range && pagination) {
      const [offset, limit] = range;
      usersQB.offset(offset).limit(limit);
    }

    // Fetch paginated or full data
    const users = await usersQB.getMany();
    const data = users.map((item) => {
      const effectiveSellerFeePercent = item.isSeller
        ? getEffectiveSellerFeePercent({
            lifetimeCadeCoins: Number(item.wallet?.lifetimeCoinsEarned || 0),
            adminFeeOverridePercent:
              item.adminFeeOverridePercent !== null &&
              item.adminFeeOverridePercent !== undefined
                ? Number(item.adminFeeOverridePercent)
                : null,
          })
        : null;
      const returnData = {
        // ...item,
        id: item.id,
        username: item.username,
        isActive: item.isActive,
        createdAt: item.createdAt,
        email: item.email,
        isVerify: item.isVerify,
        promoCode: item.promoCode,
        name: item.name,
        state: item.state,
        role: item.role,
        isSeller: item.isSeller,
        isProSubscriber: item.isProSubscriber,
        auctionsEnabled: item.auctionsEnabled,
        profileImageUrl: item.profileImageUrl,
        revShare: item.revShare,
        applicationFeePercent:
          item.applicationFeePercent !== null &&
          item.applicationFeePercent !== undefined
            ? Number(item.applicationFeePercent)
            : null,
        adminFeeOverridePercent:
          item.adminFeeOverridePercent !== null &&
          item.adminFeeOverridePercent !== undefined
            ? Number(item.adminFeeOverridePercent)
            : null,
        effectiveSellerFeePercent,
        sellerFeeSource:
          item.isSeller &&
          item.adminFeeOverridePercent !== null &&
          item.adminFeeOverridePercent !== undefined
            ? 'override'
            : item.isSeller
              ? 'milestone'
              : null,
        solanaWallet: item.solanaWallet ?? null,
        cryptoPaymentsEnabled: !!item.cryptoPaymentsEnabled,
        cryptoOverrideFeeBps:
          item.cryptoOverrideFeeBps !== null &&
          item.cryptoOverrideFeeBps !== undefined
            ? Number(item.cryptoOverrideFeeBps)
            : null,
        wallet: item.wallet
          ? {
              id: item.wallet.id,
              goldCoins: item.wallet.goldCoins,
              sweepCoins: item.wallet.sweepCoins,
              cadeCoins: item.wallet.cadeCoins,
            }
          : null,
      };

      return returnData;
    });

    return { data, total };
  }

  async updateUserStatus(
    userUpdateDto: UserUpdateDto,
  ): Promise<{ result: boolean; message: string } | undefined> {
    const { userId, userStatus } = userUpdateDto;
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Update Users table to activate user and sconst et status
    const { affected } = await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({ isActive: userStatus })
      .where('id = :userId', { userId })
      .execute();
    const message = userStatus
      ? 'User activated successfully'
      : 'User deactivated successfully';

    return { result: !!affected, message };
  }

  async findAllCreators(): Promise<{ data: User[] }> {
    const test = await this.usersRepository.find({
      where: {
        role: UserRole.CREATOR,
      },
      select: {
        id: true,
        username: true,
      },
    });
    return { data: test };
  }

  async findAllSellers(): Promise<{ data: User[] }> {
    const sellers = await this.usersRepository.find({
      where: {
        isSeller: true,
        isActive: true,
      },
      select: {
        id: true,
        username: true,
        name: true,
        shopName: true,
        profileImageUrl: true,
      },
      order: {
        username: 'ASC',
      },
    });
    return { data: sellers };
  }

  async updatePassword(userId: string, hashedPassword: string): Promise<void> {
    await this.usersRepository.update(userId, {
      password: hashedPassword,
    });
  }

  async verifyUser(userId: string): Promise<void> {
    await this.usersRepository.update(userId, {
      isVerify: true,
    });
  }

  /**
   * Updates the notification preferences of a user.
   * @param userId - The ID of the user whose notification settings are to be updated.
   * @param notificationSettingsUpdateDto - The new notification settings.
   * @returns The updated user details.
   */
  async updateNotificationSettings(
    userId: string,
    notificationSettingsUpdateDto: NotificationSettingsUpdateDto,
  ): Promise<UserResponseDto> {
    // Find the user by ID
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.cacheManager.del(`user_${user.id}_Notification_Settings`);
    // Update only provided fields in notificationPreferences
    const currentPrefs = user.notificationPreferences;

    user.notificationPreferences = {
      emailNotification:
        notificationSettingsUpdateDto.emailNotification ??
        currentPrefs?.emailNotification,
      inAppNotification:
        notificationSettingsUpdateDto.inAppNotification ??
        currentPrefs.inAppNotification,
    };
    // Save the updated user
    await this.usersRepository.save(user);

    // Return sanitized user data
    return this.findOne(userId);
  }

  /**
   * Returns the total count of active, non-deleted users with the USER role.
   * @returns Promise<number> - The number of users matching the criteria.
   */
  getUsersCount(): Promise<number> {
    return this.usersRepository.count({
      where: {
        isActive: true, // Only include users who are active
        deletedAt: null, // Exclude users who have been soft-deleted
        role: UserRole.USER, // Only count users with the USER role
      },
    });
  }

  /**
   * Retrieves the top 20 users by cadeCoins balance for the leaderboard.
   * @returns Promise<Array<{username: string, cadeCoins: number, profileImageUrl: string, monthToDateCoins: number, lifetimeCadeCoins: number}>>
   */
  async getLeaderboard(): Promise<
    Array<{
      username: string;
      cadeCoins: number;
      profileImageUrl: string;
      monthToDateCoins: number;
      lifetimeCadeCoins: number;
    }>
  > {
    const users = await this.usersRepository
      .createQueryBuilder('u')
      .innerJoin('u.wallet', 'w')
      .addSelect(['w.cadeCoins', 'w.lifetimeCoinsEarned'])
      .where('u.isActive = :isActive', { isActive: true })
      .andWhere('(u.isBanned IS NULL OR u.isBanned = false)')
      .andWhere('(u.isSuspended IS NULL OR u.isSuspended = false)')
      .andWhere('u.deletedAt IS NULL')
      .andWhere('u.username != :excludedUser', { excludedUser: 'Tom396' })
      .orderBy('w.cadeCoins', 'DESC')
      .limit(20)
      .getMany();

    // Calculate month-to-date coins for each user
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const leaderboardData = await Promise.all(
      users.map(async (u) => {
        // Calculate month-to-date CadeCoins from transactions
        // Sum of all credit transactions minus debit transactions for CADE_COINS in current month
        const monthlyTransactions = await this.transactionRepository
          .createQueryBuilder('t')
          .where('t.userId = :userId', { userId: u.id })
          .andWhere('t.currencyType = :currencyType', {
            currencyType: CurrencyType.CADE_COINS,
          })
          .andWhere('t.createdAt >= :startOfMonth', { startOfMonth })
          .getMany();

        let monthToDateCoins = 0;
        for (const transaction of monthlyTransactions) {
          const amount = Number(transaction.amount || 0);

          // BET_WON: Only count net profit (same as lifetime logic)
          if (transaction.type === TransactionType.BET_WON) {
            const originalBetAmount = Number(
              transaction.metadata?.originalBetAmount || 0,
            );
            const netProfit = amount - originalBetAmount;
            if (netProfit > 0) {
              monthToDateCoins += netProfit;
            }
          }
          // Bonuses and credits: full amount
          else if (
            [
              TransactionType.INITIAL_CREDIT,
              TransactionType.ADMIN_CREDIT,
              TransactionType.BONUS,
              TransactionType.DAILY_SPIN,
            ].includes(transaction.type)
          ) {
            monthToDateCoins += amount;
          }
          // Admin debits: subtract
          else if (transaction.type === TransactionType.ADMIN_DEBITED) {
            monthToDateCoins -= amount;
          }
          // REFUND and BET_PLACEMENT: skip (not earned)
        }

        return {
          username: u.username,
          cadeCoins: Number(u.wallet?.cadeCoins || 0),
          profileImageUrl: u.profileImageUrl || '',
          monthToDateCoins: Math.max(0, Math.floor(monthToDateCoins)),
          lifetimeCadeCoins: Number(u.wallet?.lifetimeCoinsEarned || 0),
        };
      }),
    );

    return leaderboardData;
  }
}
