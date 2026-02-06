import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WalletsService } from '../wallets/wallets.service';

import { Wallet } from 'src/wallets/entities/wallet.entity';
import { AddGoldCoinDto, UpdateCoinDto } from './dto/coin-update.dto';
import { CurrencyType } from 'src/enums/currency.enum';
import { TransactionType } from 'src/enums/transaction-type.enum';
import { formatCurrencyType } from 'src/common/utils/currency-utils';
import { UserResponseDto } from 'src/users/dto/user.response.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly walletsService: WalletsService,
  ) {}

  // This service acts primarily as a facade for admin operations
  // Most of the actual business logic is delegated to the appropriate service

  // Additional admin-specific functionality can be added here as needed
  async getSystemStats() {
    // For future implementation: Return platform statistics
    // Such as total users, active streams, betting volume, etc.
    await Promise.resolve(); // Add await to satisfy linter
    return {
      status: 'success',
      message: 'System statistics endpoint (to be implemented)',
    };
  }

  async updateCoinsByAdmin(updateCoinDto: UpdateCoinDto): Promise<Wallet> {
    const { userId, amount, currencyType } = updateCoinDto;
    // Ensure amount is not negative
    if (amount < 0) {
      throw new BadRequestException('Amount cannot be negative');
    }

    // Get current wallet to determine if this is a credit or debit
    const currentWallet = await this.walletsService.findByUserId(userId);
    let currentBalance = 0;
    switch (currencyType) {
      case CurrencyType.GOLD_COINS:
        currentBalance = Number(currentWallet.goldCoins || 0);
        break;
      case CurrencyType.CADE_COINS:
        currentBalance = Number(currentWallet.cadeCoins || 0);
        break;
      case CurrencyType.SWEEP_COINS:
        currentBalance = Number(currentWallet.sweepCoins || 0);
        break;
      default:
        this.logger.error(`Unhandled CurrencyType: ${currencyType}`);
        throw new BadRequestException(
          `Unhandled CurrencyType: ${currencyType}. ` +
            `Please update the switch statement in admin.service.ts to handle this currency type.`,
        );
    }

    // Skip transaction if there's no balance change (no-op update)
    // Round to 3 decimals to match database precision and avoid floating-point comparison issues
    const roundToThreeDecimals = (n: number) => Math.round(n * 1000) / 1000;
    if (roundToThreeDecimals(amount) === roundToThreeDecimals(currentBalance)) {
      this.logger.log(
        `No balance change detected for user ${userId}: ` +
          `amount (${amount}) equals currentBalance (${currentBalance}) for ${currencyType}`,
      );
      return currentWallet;
    }

    // Determine transaction type based on whether balance increases or decreases
    const transactionType =
      amount > currentBalance
        ? TransactionType.ADMIN_CREDIT
        : TransactionType.ADMIN_DEBITED;

    const currencyName = formatCurrencyType(currencyType);
    const description = `Admin adjustment: ${amount} ${currencyName} for user ${userId}`;

    return await this.walletsService.updateCoinsByAdmin(
      userId,
      amount,
      description,
      currencyType,
      transactionType,
    );
  }

  // Keep for backward compatibility
  async updateGoldCoinsByAdmin(
    addGoldCoinDto: AddGoldCoinDto,
  ): Promise<Wallet> {
    return this.updateCoinsByAdmin({
      userId: addGoldCoinDto.userId,
      amount: addGoldCoinDto.amount,
      currencyType: CurrencyType.GOLD_COINS,
    });
  }

  async getUserProfile(
    userId: string,
  ): Promise<
    Pick<
      UserResponseDto,
      | 'id'
      | 'username'
      | 'email'
      | 'name'
      | 'profileImageUrl'
      | 'socials'
      | 'state'
    >
  > {
    try {
      const user = await this.usersRepository.findOne({
        where: {
          id: userId,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        profileImageUrl: user.profileImageUrl,
        socials: user.socials,
        state: user.state,
      };
    } catch (e) {
      this.logger.error(
        `Error fetching profile for user with userId ${userId}:`,
        e,
      );
      throw new NotFoundException((e as Error).message);
    }
  }
}
