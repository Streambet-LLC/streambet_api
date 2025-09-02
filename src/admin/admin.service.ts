import { BadRequestException, Injectable } from '@nestjs/common';
import { WalletsService } from '../wallets/wallets.service';
import {
  CurrencyType,
  TransactionType,
} from 'src/wallets/entities/transaction.entity';
import { Wallet } from 'src/wallets/entities/wallet.entity';
import { AddGoldCoinDto } from './dto/gold-coin-update.dto';
import { WalletGateway } from 'src/wallets/wallets.gateway';

@Injectable()
export class AdminService {
  constructor(
    private readonly walletGateway: WalletGateway,
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
    await this.walletGateway.emitAdminAddedGoldCoin(userId);
    return updateResult;
  }
}
