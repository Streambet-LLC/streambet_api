import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Transaction } from '../wallets/entities/transaction.entity';
import { WalletsService } from '../wallets/wallets.service';
import { WalletGateway } from '../wallets/wallets.gateway';
import { CurrencyType } from '../enums/currency.enum';
import { TransactionType } from '../enums/transaction-type.enum';
import {
  SPIN_REWARDS,
  DAILY_RESET_HOUR_UTC,
  DAILY_RESET_MINUTE_UTC,
} from './daily-spin.constants';
import { SpinResultDto } from './dto/spin-result.dto';
import { SpinStatusDto } from './dto/spin-status.dto';

@Injectable()
export class DailySpinService {
  private readonly logger = new Logger(DailySpinService.name);

  constructor(
    @InjectRepository(Transaction)
    private transactionsRepository: Repository<Transaction>,
    private walletsService: WalletsService,
    private walletGateway: WalletGateway,
  ) {}

  /**
   * Execute a daily spin for the user
   *
   * @param userId - User ID
   * @returns Spin result with reward details
   * @throws BadRequestException if user has already spun today
   */
  async executeSpin(userId: string): Promise<SpinResultDto> {
    const todayResetTime = this.getTodayResetTime();
    const spinId = this.generateSpinId(userId, todayResetTime);

    // Check if user has already spun today
    const existingSpin = await this.transactionsRepository.findOne({
      where: {
        relatedEntityId: spinId,
        relatedEntityType: 'daily-spin',
      },
    });

    if (existingSpin) {
      throw new BadRequestException(
        'You have already spun today. Please try again tomorrow.',
      );
    }

    // Generate random value
    const randomValue = this.generateRandomValue();

    // Select reward based on probability ranges
    const reward = this.selectReward(randomValue);

    // Update wallet balance (this also updates lifetimeCoinsEarned automatically)
    const wallet = await this.walletsService.updateBalance(
      userId,
      reward,
      CurrencyType.CADE_COINS,
      TransactionType.DAILY_SPIN,
      `Daily spin reward: ${reward} CadeCoins`,
      { randomValue, reward },
      {
        relatedEntityId: spinId,
        relatedEntityType: 'daily-spin',
      },
    );

    // Get the transaction using the unique spin ID
    const transaction = await this.transactionsRepository.findOne({
      where: {
        relatedEntityId: spinId,
        relatedEntityType: 'daily-spin',
      },
    });

    this.logger.log(
      `User ${userId} spun the wheel and won ${reward} CadeCoins (spinId: ${spinId})`,
    );

    // Emit real-time update to frontend
    this.walletGateway.emitDailySpinReward(userId, {
      reward,
      cadeCoinsBalance: Number(wallet.cadeCoins),
      lifetimeCoinsEarned: Number(wallet.lifetimeCoinsEarned),
      nextSpinAt: this.getNextResetTime(),
    });

    return {
      reward,
      cadeCoinsBalance: Number(wallet.cadeCoins),
      lifetimeCoinsEarned: Number(wallet.lifetimeCoinsEarned),
      nextSpinAt: this.getNextResetTime(),
      transactionId: transaction.id,
    };
  }

  /**
   * Get user's spin status
   *
   * @param userId - User ID
   * @returns Spin status with timing info
   */
  async getSpinStatus(userId: string): Promise<SpinStatusDto> {
    const todayResetTime = this.getTodayResetTime();
    const nextResetTime = this.getNextResetTime();
    const spinId = this.generateSpinId(userId, todayResetTime);

    // Check if user has already spun today
    const lastSpin = await this.transactionsRepository.findOne({
      where: {
        relatedEntityId: spinId,
        relatedEntityType: 'daily-spin',
      },
    });

    const canSpin = !lastSpin;
    const timeUntilNextSpin = this.calculateTimeRemaining(nextResetTime);

    return {
      canSpin,
      nextSpinAt: nextResetTime,
      timeUntilNextSpin,
      lastSpinAt: lastSpin?.createdAt,
    };
  }

  /**
   * Generate a random number between 0 and 1
   */
  private generateRandomValue(): number {
    const bytes = randomBytes(4);
    return bytes.readUInt32BE(0) / 0xffffffff;
  }

  /**
   * Select reward based on random value and probability ranges
   */
  private selectReward(randomValue: number): number {
    for (const reward of SPIN_REWARDS) {
      if (randomValue >= reward.min && randomValue < reward.max) {
        return reward.coins;
      }
    }
    // Fallback to smallest reward
    return SPIN_REWARDS[0].coins;
  }

  /**
   * Get today's reset time (midnight UTC today)
   */
  private getTodayResetTime(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        DAILY_RESET_HOUR_UTC,
        DAILY_RESET_MINUTE_UTC,
        0,
        0,
      ),
    );
  }

  /**
   * Get next reset time (midnight UTC tomorrow)
   */
  private getNextResetTime(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        DAILY_RESET_HOUR_UTC,
        DAILY_RESET_MINUTE_UTC,
        0,
        0,
      ),
    );
  }

  /**
   * Calculate time remaining
   */
  private calculateTimeRemaining(futureDate: Date): {
    hours: number;
    minutes: number;
    seconds: number;
  } {
    const now = new Date();
    const diffMs = futureDate.getTime() - now.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);

    const hours = Math.floor(diffSeconds / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    const seconds = diffSeconds % 60;

    return { hours, minutes, seconds };
  }

  /**
   * Generate a unique spin ID for idempotency
   * Format: daily-spin-{userId}-{YYYY-MM-DD}
   */
  private generateSpinId(userId: string, date: Date): string {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    return `daily-spin-${userId}-${dateStr}`;
  }
}
