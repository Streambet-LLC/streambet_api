import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { BettingService } from '../betting/betting.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  CurrencyType,
  TransactionType,
} from 'src/wallets/entities/transaction.entity';
import { Wallet } from 'src/wallets/entities/wallet.entity';
import { AddFreeTokenDto } from './dto/free-token-update.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly bettingService: BettingService,
    private readonly usersService: UsersService,
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

  async softDeleteUser(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const timestamp = new Date().getTime();

    // Update email and username with timestamp
    const updatedEmail = `${user.email}_${timestamp}`;
    const updatedUsername = `${user.username}_${timestamp}`;

    // Set deletion fields
    user.email = updatedEmail;
    user.username = updatedUsername;
    user.deletedAt = new Date();

    // Save the updated user
    return this.userRepository.save(user);
  }

  async updateFreeTokensByAdmin(
    addFreeTokenDto: AddFreeTokenDto,
  ): Promise<Wallet> {
    const { userId, amount } = addFreeTokenDto;
    // Ensure amount is positive for admin updates
    if (amount <= 0) {
      throw new BadRequestException('Plz enter valid amount ');
    }
    const description = `Admin credit adjustment of ${amount} free tokens for user ${userId}`;
    return this.walletsService.updateBalance(
      userId,
      amount,
      CurrencyType.FREE_TOKENS,
      TransactionType.ADMIN_CREDIT,
      description,
    );
  }
}
