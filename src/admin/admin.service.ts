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
import { BetStatus } from 'src/enums/bet-status.enum';
import { AddGoldCoinDto } from './dto/gold-coin-update.dto';

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
    // Deactivate and invalidate tokens immediately
    user.isActive = false;
    user.refreshToken = null;
    user.refreshTokenExpiresAt = null;

    // Save the updated user
    return this.userRepository.save(user);
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
    return this.walletsService.updateGoldCoinsByAdmin(
      userId,
      amount,
      description,
      CurrencyType.GOLD_COINS,
      TransactionType.ADMIN_CREDIT,
    );
  }

  /**
   * Returns all rounds for a stream, with their options and winners (if any), separated by currency type.
   * @param streamId string
   */
  async getStreamRoundsWithWinners(streamId: string) {
    // Get all rounds for the stream, with their betting variables and bets
    const rounds = await this.bettingService['bettingRoundsRepository'].find({
      where: { streamId },
      relations: [
        'bettingVariables',
        'bettingVariables.bets',
        'bettingVariables.bets.user',
      ],
      order: { createdAt: 'ASC' },
    });

    // Compose the response
    const result = {
      streamId,
      rounds: [] as any[],
    };

    for (const round of rounds) {
      // Get all options for this round
      const options = round.bettingVariables.map((variable) => ({
        id: variable.id,
        option: variable.name,
      }));

      // Find the winning option(s)
      const winningOptions = round.bettingVariables.filter(
        (v) => v.is_winning_option,
      );
      let winners = { goldCoins: [], sweepCoins: [] };
      let winnerAmount = { goldCoins: null, sweepCoins: null };
      if (winningOptions.length > 0) {
        // For each winning option, get all bets by currency
        const winnerBetsGoldCoins = winningOptions.flatMap((v) =>
          (v.bets || []).filter(
            (bet) =>
              bet.currency === CurrencyType.GOLD_COINS &&
              bet.status === BetStatus.Won,
          ),
        );
        const winnerBetsSweepCoins = winningOptions.flatMap((v) =>
          (v.bets || []).filter(
            (bet) =>
              bet.currency === CurrencyType.SWEEP_COINS &&
              bet.status === BetStatus.Won,
          ),
        );
        // Remove duplicate users (in case a user bet multiple times)
        const winnerUsersMapGoldCoins = new Map();
        for (const bet of winnerBetsGoldCoins) {
          if (
            bet.user &&
            !winnerUsersMapGoldCoins.has(bet.user.id) &&
            bet.status === BetStatus.Won
          ) {
            winnerUsersMapGoldCoins.set(bet.user.id, {
              userId: bet.user.id,
              userName: bet.user.username,
              avatar: bet.user.profileImageUrl,
            });
          }
        }
        const winnerUsersMapSweepCoins = new Map();
        for (const bet of winnerBetsSweepCoins) {
          if (
            bet.user &&
            !winnerUsersMapSweepCoins.has(bet.user.id) &&
            bet.status === BetStatus.Won
          ) {
            winnerUsersMapSweepCoins.set(bet.user.id, {
              userId: bet.user.id,
              userName: bet.user.username,
              avatar: bet.user.profileImageUrl,
            });
          }
        }
        winners.goldCoins = Array.from(winnerUsersMapGoldCoins.values());
        winners.sweepCoins = Array.from(winnerUsersMapSweepCoins.values());
        // Calculate winnerAmount (sum of payouts for this round's winning bets)
        const winnerAmountGoldCoins = winnerBetsGoldCoins.reduce(
          (sum, bet) => Number(sum) + (Number(bet.payoutAmount) || 0),
          0,
        );
        const winnerAmountSweepCoins = winnerBetsSweepCoins.reduce(
          (sum, bet) => Number(sum) + (Number(bet.payoutAmount) || 0),
          0,
        );
        winnerAmount.goldCoins = winnerAmountGoldCoins
          ? winnerAmountGoldCoins
          : null;
        winnerAmount.sweepCoins = winnerAmountSweepCoins
          ? winnerAmountSweepCoins
          : null;
      }

      result.rounds.push({
        roundId: round.id,
        roundName: round.roundName,
        status: round.status,
        winnerAmount,
        winners,
        options,
      });
    }
    return result;
  }
}
