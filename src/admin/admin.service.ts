import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WalletsService } from '../wallets/wallets.service';

import { Wallet } from 'src/wallets/entities/wallet.entity';
import { AddGoldCoinDto } from './dto/gold-coin-update.dto';
import { CurrencyType } from 'src/enums/currency.enum';
import { TransactionType } from 'src/enums/transaction-type.enum';
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

  async updateGoldCoinsByAdmin(
    addGoldCoinDto: AddGoldCoinDto,
  ): Promise<Wallet> {
    const { userId, amount } = addGoldCoinDto;
    // Ensure amount is positive for admin updates
    if (amount <= 0) {
      throw new BadRequestException('Invalid amount');
    }
    const description = `Admin credit adjustment of ${amount} Gold Coins for user ${userId}`;
    const updateResult = await this.walletsService.updateGoldCoinsByAdmin(
      userId,
      amount,
      description,
      CurrencyType.GOLD_COINS,
      TransactionType.ADMIN_CREDIT,
    );
    //emit an event to the user, notify about the coin updation
    return updateResult;
  }

  async getUserProfile(
    userId: string,
  ): Promise<Pick<UserResponseDto, 'id' | 'username' | 'email' | 'name' | 'profileImageUrl' | 'socials' | 'state'>> {
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
      this.logger.error(`Error fetching profile for user with userId ${userId}:`, e);
      throw new NotFoundException((e as Error).message);
    }
  }
}
