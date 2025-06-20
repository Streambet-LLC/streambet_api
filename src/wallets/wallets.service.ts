import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import {
  Transaction,
  TransactionType,
  CurrencyType,
} from './entities/transaction.entity';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private walletsRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private transactionsRepository: Repository<Transaction>,
    private dataSource: DataSource,
  ) {}

  async create(userId: string): Promise<Wallet> {
    // Create wallet with initial 1000 free tokens
    const wallet = this.walletsRepository.create({ userId });
    const savedWallet = await this.walletsRepository.save(wallet);

    // Record the initial credit transaction
    await this.createTransaction({
      userId,
      type: TransactionType.INITIAL_CREDIT,
      currencyType: CurrencyType.FREE_TOKENS,
      amount: 1000,
      balanceAfter: 1000,
      description: 'Initial free tokens on registration',
    });

    return savedWallet;
  }

  async findByUserId(userId: string): Promise<Wallet> {
    const wallet = await this.walletsRepository.findOne({
      where: { userId },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet for user with ID ${userId} not found`,
      );
    }
    return wallet;
  }

  async addFreeTokens(
    userId: string,
    amount: number,
    description: string,
  ): Promise<Wallet> {
    return this.updateBalance(
      userId,
      amount,
      CurrencyType.FREE_TOKENS,
      TransactionType.SYSTEM_ADJUSTMENT,
      description,
    );
  }

  async addStreamCoins(
    userId: string,
    amount: number,
    description: string,
  ): Promise<Wallet> {
    return this.updateBalance(
      userId,
      amount,
      CurrencyType.STREAM_COINS,
      TransactionType.PURCHASE,
      description,
    );
  }

  async deductForBet(
    userId: string,
    amount: number,
    currencyType: CurrencyType,
    description: string,
  ): Promise<Wallet> {
    return this.updateBalance(
      userId,
      -amount,
      currencyType,
      TransactionType.BET_PLACEMENT,
      description,
    );
  }

  async creditWinnings(
    userId: string,
    amount: number,
    currencyType: CurrencyType,
    description: string,
  ): Promise<Wallet> {
    return this.updateBalance(
      userId,
      amount,
      currencyType,
      TransactionType.BET_WINNINGS,
      description,
    );
  }

  async updateBalance(
    userId: string,
    amount: number,
    currencyType: CurrencyType,
    transactionType: TransactionType,
    description: string,
    metadata?: Record<string, any>,
  ): Promise<Wallet> {
    // Use a transaction to ensure data consistency
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get the wallet
      const wallet = await queryRunner.manager.findOne(Wallet, {
        where: { userId },
        lock: { mode: 'pessimistic_write' }, // Lock the row for update
      });

      if (!wallet) {
        throw new NotFoundException(
          `Wallet for user with ID ${userId} not found`,
        );
      }

      // Calculate new balance
      let newBalance: number;
      if (currencyType === CurrencyType.FREE_TOKENS) {
        newBalance = wallet.freeTokens + amount;
        if (newBalance < 0) {
          throw new BadRequestException('Insufficient free tokens');
        }
        wallet.freeTokens = newBalance;
      } else {
        newBalance = wallet.streamCoins + amount;
        if (newBalance < 0) {
          throw new BadRequestException('Insufficient stream coins');
        }
        wallet.streamCoins = newBalance;
      }

      // Save the updated wallet
      await queryRunner.manager.save(wallet);

      // Create a transaction record
      const transaction = this.transactionsRepository.create({
        userId,
        type: transactionType,
        currencyType,
        amount,
        balanceAfter: newBalance,
        description,
        metadata,
      });

      await queryRunner.manager.save(transaction);

      // Commit the transaction
      await queryRunner.commitTransaction();

      return wallet;
    } catch (error) {
      // Rollback in case of error
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }

  async getTransactionHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Transaction[]> {
    return this.transactionsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  private async createTransaction(
    transactionData: Partial<Transaction>,
  ): Promise<Transaction> {
    const transaction = this.transactionsRepository.create(transactionData);
    return this.transactionsRepository.save(transaction);
  }
  async updateFreeTokensByAdmin(
    userId: string,
    amount: number,
    description: string,
  ): Promise<Wallet> {
    // Ensure amount is positive for admin updates
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
    return this.updateBalance(
      userId,
      amount,
      CurrencyType.FREE_TOKENS,
      TransactionType.ADMIN_CREDIT,
      description,
    );
  }
}
