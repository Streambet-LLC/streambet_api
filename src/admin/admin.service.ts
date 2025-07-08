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
      throw new BadRequestException('Invalid amount');
    }
    const description = `Admin credit adjustment of ${amount} free tokens for user ${userId}`;
    return this.walletsService.updateFreeTokensByAdmin(
      userId,
      amount,
      description,
      CurrencyType.FREE_TOKENS,
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
      let winners = { freeTokens: [], streamCoins: [] };
      let winnerAmount = { freeTokens: null, streamCoins: null };
      if (winningOptions.length > 0) {
        // For each winning option, get all bets by currency
        const winnerBetsFreeTokens = winningOptions.flatMap((v) =>
          (v.bets || []).filter((bet) => bet.currency === 'free_tokens'),
        );

        console.log('Winner Bets (Free Tokens):', winnerBetsFreeTokens);
        const winnerBetsStreamCoins = winningOptions.flatMap((v) =>
          (v.bets || []).filter((bet) => bet.currency === 'stream_coins'),
        );
        // Remove duplicate users (in case a user bet multiple times)
        const winnerUsersMapFreeTokens = new Map();
        for (const bet of winnerBetsFreeTokens) {
          if (bet.user && !winnerUsersMapFreeTokens.has(bet.user.id)) {
            winnerUsersMapFreeTokens.set(bet.user.id, {
              userId: bet.user.id,
              userName: bet.user.username,
              avatar: bet.user.profileImageUrl,
            });
          }
        }
        const winnerUsersMapStreamCoins = new Map();
        for (const bet of winnerBetsStreamCoins) {
          if (bet.user && !winnerUsersMapStreamCoins.has(bet.user.id)) {
            winnerUsersMapStreamCoins.set(bet.user.id, {
              userId: bet.user.id,
              userName: bet.user.username,
              avatar: bet.user.profileImageUrl,
            });
          }
        }
        winners.freeTokens = Array.from(winnerUsersMapFreeTokens.values());
        winners.streamCoins = Array.from(winnerUsersMapStreamCoins.values());
        // Calculate winnerAmount (sum of payouts for this round's winning bets)
        const winnerAmountFreeTokens = winnerBetsFreeTokens.reduce(
          (sum, bet) => Number(sum) + (Number(bet.payoutAmount) || 0),
          0,
        );
        const winnerAmountStreamCoins = winnerBetsStreamCoins.reduce(
          (sum, bet) => Number(sum) + (Number(bet.payoutAmount) || 0),
          0,
        );
        winnerAmount.freeTokens = winnerAmountFreeTokens
          ? winnerAmountFreeTokens
          : null;
        winnerAmount.streamCoins = winnerAmountStreamCoins
          ? winnerAmountStreamCoins
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
