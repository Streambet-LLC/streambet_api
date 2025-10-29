import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { TransactionFilterDto } from './dto/transaction.list.dto';
import { HistoryType } from 'src/enums/history-type.enum';
import {
  SWEEP_COINS_PER_DOLLAR,
  MIN_WITHDRAWABLE_SWEEP_COINS,
} from 'src/common/constants/currency.constants';
import { WalletGateway } from './wallets.gateway';
import { CurrencyType } from 'src/enums/currency.enum';
import { TransactionType } from 'src/enums/transaction-type.enum';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);
  constructor(
    @InjectRepository(Wallet)
    private walletsRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private transactionsRepository: Repository<Transaction>,
    private dataSource: DataSource,
    private walletGateway: WalletGateway,
  ) { }

  /**
   * Create a wallet for a user with initial balance.
   *
   * Purpose:
   * - Creates a wallet for a new user.
   * - Credits the wallet with an initial balance of 1000 Gold Coins.
   * - Records the transaction in the transactions table.
   *
   * @param userId - The ID of the user for whom the wallet is created.
   * @returns The saved wallet entity.
   */
  async create(userId: string): Promise<Wallet> {
    // Create wallet with initial 1000 Gold Coin
    const wallet = this.walletsRepository.create({ userId });
    const savedWallet = await this.walletsRepository.save(wallet);

    // Record the initial credit transaction
    await this.createTransaction({
      userId,
      type: TransactionType.INITIAL_CREDIT,
      currencyType: CurrencyType.GOLD_COINS,
      amount: 1000,
      balanceAfter: 1000,
      description: 'Initial Gold Coins on registration',
    });

    return savedWallet;
  }

  /**
   * findByUserId - Retrieves a wallet by user ID.
   *
   * Purpose:
   * - Fetches the wallet associated with a given user ID from the repository.
   * - Ensures that the wallet exists before returning it.
   *
   * @param userId - The unique identifier of the user whose wallet is being retrieved.
   * @returns Promise<Wallet> - The wallet entity corresponding to the user.
   * @throws NotFoundException - If no wallet is found for the given user ID.
   */
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

  /**
   * addGoldCoins - Credits gold coins to a user's wallet.
   *
   * Purpose:
   * - Adds gold coins to the specified user's wallet balance.
   * - Always uses `TransactionType.REFUND` as the transaction type since this method is designed
   *   for refund scenarios (adjustments, reversals, or compensation).
   *
   * @param userId - The ID of the user whose wallet should be credited.
   * @param amount - The number of gold coins to add.
   * @param description - A description for the transaction record (e.g., "Bet refund").
   * @param manager - Optional TypeORM EntityManager for transactional updates.
   * @returns A Promise resolving to the updated Wallet entity.
   */
  async addGoldCoins(
    userId: string,
    amount: number,
    description: string,
    manager?: EntityManager,
  ): Promise<Wallet> {
    return this.updateBalance(
      userId,
      amount,
      CurrencyType.GOLD_COINS,
      TransactionType.REFUND,
      description,
      undefined,
      undefined,
      manager,
    );
  }

  /**
   * addSweepCoins - Adds sweep coins to a user's wallet.
   *
   * Purpose:
   * - Handles incrementing a user's sweep coin balance for purchases or refunds.
   * - Creates a corresponding transaction record.
   *
   */
  async addSweepCoins(
    userId: string,
    amount: number,
    description: string,
    type: string,
    manager?: EntityManager,
  ): Promise<Wallet> {
    let addType = TransactionType.PURCHASE;
    if (type === 'refund') {
      addType = TransactionType.REFUND;
    }
    return this.updateBalance(
      userId,
      amount,
      CurrencyType.SWEEP_COINS,
      addType,
      description,
      undefined,
      undefined,
      manager,
    );
  }

  /**
   * deductForBet - Deducts a specified bet amount from the user's wallet.
   *
   * Purpose:
   * - Decreases the user's wallet balance in the specified currency.
   * - Records the transaction as a bet placement (`TransactionType.BET_PLACEMENT`).
   *
   */
  async deductForBet(
    userId: string,
    amount: number,
    currencyType: CurrencyType,
    description: string,
    manager?: EntityManager,
  ): Promise<Wallet> {
    return this.updateBalance(
      userId,
      -amount,
      currencyType,
      TransactionType.BET_PLACEMENT,
      description,
      undefined,
      undefined,
      manager,
    );
  }

  /**
   * creditWinnings - Credits winnings to a user's wallet.
   *
   * Purpose:
   * - Adds the specified winning amount to the user's wallet balance.
   * - Records the transaction as `BET_WON` for tracking purposes.
   *
   * Parameters:
   * - userId (string): The ID of the user receiving the winnings.
   * - amount (number): The amount to credit.
   * - currencyType (CurrencyType): Type of currency (e.g., GOLD, SWEEP).
   * - description (string): A description of the transaction.
   * - manager (EntityManager, optional): Used when part of a larger transaction flow.
   *
   * Returns:
   * - Promise<Wallet>: The updated wallet after crediting the winnings.
   *
   */
  async creditWinnings(
    userId: string,
    amount: number,
    currencyType: CurrencyType,
    description: string,
    manager?: EntityManager,
  ): Promise<Wallet> {
    return this.updateBalance(
      userId,
      amount,
      currencyType,
      TransactionType.BET_WON,
      description,
      undefined,
      undefined,
      manager,
    );
  }

  async creditPayout(
    userId: string,
    amount: number,
    currencyType: CurrencyType,
    description: string,
    manager?: EntityManager,
  ): Promise<Wallet> {
    return this.updateBalance(
      userId,
      amount,
      currencyType,
      TransactionType.CREATOR_PAYOUT,
      description,
      undefined,
      undefined,
      manager,
    );
  }

  /**
   * updateBalance - Updates a user's wallet balance and records the transaction.
   *
   * - Supports both externally managed (with EntityManager) and self-managed transactions.
   * - Locks wallet row for safe concurrent balance updates.
   * - Validates wallet existence and ensures balance does not go negative.
   * - Optionally prevents duplicate transactions using relatedEntityId / relatedEntityType.
   * - Creates and saves a corresponding transaction record with metadata.
   * - Rolls back on failure when self-managing the transaction.
   *
   * @param userId - ID of the user whose balance will be updated
   * @param amount - Amount to adjust (positive for credit, negative for debit)
   * @param currencyType - Type of currency (Gold Coins / Sweep Coins)
   * @param transactionType - Type of transaction (Deposit, Withdrawal, Bet, etc.)
   * @param description - Description of the transaction
   * @param metadata - Optional extra transaction metadata
   * @param options - Optional related entity references for uniqueness checks
   * @param manager - Optional EntityManager for external transaction handling
   * @returns Updated Wallet entity
   */
  async updateBalance(
    userId: string,
    amount: number,
    currencyType: CurrencyType,
    transactionType: TransactionType,
    description: string,
    metadata?: Record<string, any>,
    options?: { relatedEntityId?: string; relatedEntityType?: string },
    manager?: EntityManager,
  ): Promise<Wallet> {
    // If a manager is provided, use it; otherwise, manage our own transaction
    if (manager) {
      const wallet = await manager.findOne(Wallet, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) {
        throw new NotFoundException(
          `Wallet for user with ID ${userId} not found`,
        );
      }

      if (options?.relatedEntityId) {
        const existingCount = await manager.getRepository(Transaction).count({
          where: {
            relatedEntityId: options.relatedEntityId,
            ...(options.relatedEntityType
              ? { relatedEntityType: options.relatedEntityType }
              : {}),
            type: transactionType,
            currencyType,
          },
        });
        if (existingCount > 0) {
          return wallet;
        }
      }

      let newBalance: number;
      if (currencyType === CurrencyType.GOLD_COINS) {
        newBalance = Number(wallet.goldCoins) + Number(amount);
        if (newBalance < 0) {
          throw new BadRequestException('Insufficient free Gold Coins');
        }
        wallet.goldCoins = Number(newBalance);
      } else {
        newBalance = Number(wallet.sweepCoins) + Number(amount);
        if (newBalance < 0) {
          throw new BadRequestException('Insufficient Stream Coins');
        }
        wallet.sweepCoins = Number(newBalance);
      }

      await manager.save(wallet);

      const transactionRepo = manager.getRepository(Transaction);
      const transaction = transactionRepo.create({
        userId,
        type: transactionType,
        currencyType,
        amount,
        balanceAfter: newBalance,
        description,
        metadata,
        relatedEntityId: options?.relatedEntityId,
        relatedEntityType: options?.relatedEntityType,
      });
      await manager.save(transaction);

      return wallet;
    }

    // Self-managed transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const wallet = await queryRunner.manager.findOne(Wallet, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!wallet) {
        throw new NotFoundException(
          `Wallet for user with ID ${userId} not found`,
        );
      }

      if (options?.relatedEntityId) {
        const existingCount = await queryRunner.manager
          .getRepository(Transaction)
          .count({
            where: {
              relatedEntityId: options.relatedEntityId,
              ...(options.relatedEntityType
                ? { relatedEntityType: options.relatedEntityType }
                : {}),
              type: transactionType,
              currencyType,
            },
          });
        if (existingCount > 0) {
          await queryRunner.rollbackTransaction();
          return wallet;
        }
      }

      let newBalance: number;
      if (currencyType === CurrencyType.GOLD_COINS) {
        newBalance = Number(wallet.goldCoins) + Number(amount);
        if (newBalance < 0) {
          throw new BadRequestException('Insufficient free Gold Coins');
        }
        wallet.goldCoins = Number(newBalance);
      } else {
        newBalance = Number(wallet.sweepCoins) + Number(amount);
        if (newBalance < 0) {
          throw new BadRequestException('Insufficient Stream Coins');
        }
        wallet.sweepCoins = Number(newBalance);
      }

      await queryRunner.manager.save(wallet);

      const transaction = queryRunner.manager
        .getRepository(Transaction)
        .create({
          userId,
          type: transactionType,
          currencyType,
          amount,
          balanceAfter: newBalance,
          description,
          metadata,
          relatedEntityId: options?.relatedEntityId,
          relatedEntityType: options?.relatedEntityType,
        });
      await queryRunner.manager.save(transaction);

      await queryRunner.commitTransaction();
      return wallet;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * hasTransactionForRelatedEntity - Checks if a transaction exists for a related entity.
   *
   * - Filters by relatedEntityId (required).
   * - Optionally filters by relatedEntityType and currencyType.
   * - Uses provided EntityManager if available, otherwise default repository.
   * - Returns true if at least one matching transaction exists, otherwise false.
   *
   * @param relatedEntityId - ID of the related entity
   * @param transactionType - Transaction type filter
   * @param relatedEntityType - Optional type of related entity
   * @param currencyType - Optional currency type filter
   * @param manager - Optional EntityManager for transactional queries
   */
  async hasTransactionForRelatedEntity(
    relatedEntityId: string,
    transactionType: TransactionType,
    relatedEntityType?: string,
    currencyType?: CurrencyType,
    manager?: EntityManager,
  ): Promise<boolean> {
    const where: any = { relatedEntityId };
    if (relatedEntityType) where.relatedEntityType = relatedEntityType;
    if (currencyType) where.currencyType = currencyType;
    where.type = transactionType;
    if (manager) {
      const count = await manager.getRepository(Transaction).count({ where });
      return count > 0;
    }
    const count = await this.transactionsRepository.count({ where });
    return count > 0;
  }

  /**
   * getAllTransactionHistory - Retrieves paginated and filtered transaction history for a user.
   *
   * - Supports filtering by history type (Transaction / Bet).
   * - Allows text search on description.
   * - Supports sorting and pagination.
   * - Returns matching transaction records and the total count.
   * - Throws BadRequestException for invalid filter/sort format.
   * - Throws HttpException if query execution fails.
   *
   * @param transactionFilterDto - DTO containing filters, sorting, and pagination details
   * @param userId - ID of the user whose transactions are being fetched
   */
  async getAllTransactionHistory(
    transactionFilterDto: TransactionFilterDto,
    userId: string,
  ) {
    let sort: Sort;
    let filter: FilterDto;
    let range: Range = [0, 10];

    try {
      try {
        sort = transactionFilterDto.sort
          ? JSON.parse(transactionFilterDto.sort)
          : undefined;
        filter = transactionFilterDto.filter
          ? JSON.parse(transactionFilterDto.filter)
          : undefined;
        range = transactionFilterDto.range
          ? JSON.parse(transactionFilterDto.range)
          : [0, 10];
      } catch (parseError) {
        throw new BadRequestException('Invalid filter format');
      }

      const { pagination = true, historyType } = transactionFilterDto;

      const transactionQB = this.transactionsRepository
        .createQueryBuilder('t')
        .where('t.userId = :userId', { userId });
      if (historyType === HistoryType.Transaction) {
        transactionQB.andWhere('t.type  IN (:...includedTypes)', {
          includedTypes: [
            TransactionType.ADMIN_CREDIT,
            TransactionType.DEPOSIT,
            TransactionType.WITHDRAWAL,
            TransactionType.WITHDRAWAL_PENDING,
            TransactionType.WITHDRAWAL_FAILED,
            TransactionType.WITHDRAWAL_SUCCESS,
            TransactionType.PURCHASE,
            TransactionType.INITIAL_CREDIT,
            TransactionType.BONUS,
          ],
        });
      }
      if (historyType === HistoryType.Bet) {
        transactionQB.andWhere('t.type  IN (:...includedTypes)', {
          includedTypes: [TransactionType.BET_LOST, TransactionType.BET_WON],
        });
      }
      if (filter?.q) {
        transactionQB.andWhere(`(LOWER(t.description) ILIKE LOWER(:q) )`, {
          q: `%${filter.q}%`,
        });
      }
      if (sort) {
        const [sortColumn, sortOrder] = sort;
        transactionQB.orderBy(
          `t.${sortColumn}`,
          sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
        );
      }

      const total = await transactionQB.getCount();
      if (pagination && range) {
        const [offset, limit] = range;
        transactionQB.offset(offset).limit(limit);
      }
      transactionQB.select([
        't.id AS transId',
        't.createdAt AS createdAt',
        't.updatedAt AS updatedAt',
        't.userId AS userId',
        't.type AS type',
        't.currencyType AS currencyType',
        't.amount AS amount',
        't.balanceAfter AS balanceAfter',
        't.description AS description',
      ]);
      const data = await transactionQB.getRawMany();
      return { data, total };
    } catch (e) {
      Logger.error('Unable to list stream details', e);
      throw new HttpException(
        `Unable to retrieve transaction details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   *    * createTransaction - Creates and saves a new transaction record.
   *
   * - Accepts partial transaction data.
   * - Uses the transactions repository to create a transaction entity.
   * - Persists the transaction in the database.
   * - Returns the saved transaction.
   *
   * @param transactionData - Partial transaction details
   */
  private async createTransaction(
    transactionData: Partial<Transaction>,
  ): Promise<Transaction> {
    const transaction = this.transactionsRepository.create(transactionData);
    return this.transactionsRepository.save(transaction);
  }

  /**
   * updateGoldCoinsByAdmin - Updates a user's gold coin balance by an admin.
   *
   * - Ensures the provided amount is positive.
   * - Updates the user's gold coin balance.
   * - Determines whether the operation is an admin credit or debit.
   * - Creates and saves a corresponding transaction record.
   * - Returns the updated wallet entity.
   *
   * @param userId - ID of the user whose wallet is being updated
   * @param amount - New gold coin balance to set
   * @param description - Description for the transaction
   * @param currencyType - Type of currency (should be GOLD_COINS)
   * @param transactionType - Original transaction type (overridden internally)
   */
  async updateGoldCoinsByAdmin(
    userId: string,
    amount: number,
    description: string,
    currencyType: CurrencyType,
    transactionType: TransactionType,
  ): Promise<Wallet> {
    const wallet = await this.findByUserId(userId);
    if (!wallet) {
      throw new NotFoundException(
        `Wallet for user with ID ${userId} not found`,
      );
    }
    // Ensure amount is positive for admin updates
    if (amount <= 0) {
      throw new BadRequestException('Invalid Amount');
    }

    if (currencyType === CurrencyType.GOLD_COINS) {
      await this.walletsRepository.update(wallet.id, { goldCoins: amount });
      const addedAmount = amount - wallet.goldCoins;

      const transactionType =
        addedAmount >= 0
          ? TransactionType.ADMIN_CREDIT
          : TransactionType.ADMIN_DEBITED;
      const trans = this.transactionsRepository.create({
        userId,
        type: transactionType,
        currencyType,
        amount: addedAmount,
        balanceAfter: amount,
        description,
      });
      await this.transactionsRepository.save(trans);

      // fire-and-forget; log on failure so admin API success isn't affected by WS issues
      void this.walletGateway
        .emitAdminAddedGoldCoin(userId)
        .catch((err) =>
          this.logger?.warn?.(
            `emitAdminAddedGoldCoin failed for ${userId}: ${err?.message ?? err}`,
          ),
        );
    }

    return await this.findByUserId(userId);
  }

  /**
   * walletDetailsByUserId - Fetches wallet details for a given user.
   *
   * - Returns the wallet entity if found, otherwise null.
   *
   * @param userId - ID of the user
   */
  async walletDetailsByUserId(userId: string) {
    return await this.walletsRepository.findOne({
      where: { userId },
    });
  }

  /**
   * createTransactionData - Creates a transaction record for a user's wallet.
   *
   * - Looks up the user's wallet by userId.
   * - Creates a new transaction entry with updated balance information.
   * - Saves the transaction using the provided EntityManager or default manager.
   *
   * @param userId - ID of the user
   * @param transactionType - Type of transaction
   * @param currencyType - Type of currency (gold or sweep coins)
   * @param amount - Transaction amount
   * @param description - Description for the transaction
   * @param manager - Optional EntityManager for transactional operations
   */
  async createTransactionData(
    userId: string,
    transactionType: TransactionType,
    currencyType: CurrencyType,
    amount: number,
    description: string,
    manager?: EntityManager,
  ) {
    const repoManager = manager ?? this.dataSource.manager;
    const wallet = await repoManager.findOne(Wallet, {
      where: { userId },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet for user with ID ${userId} not found`,
      );
    }

    const balanceAfter =
      currencyType === CurrencyType.GOLD_COINS
        ? wallet.goldCoins
        : wallet.sweepCoins;
    const transactionObj = repoManager.getRepository(Transaction).create({
      userId,
      type: transactionType,
      currencyType,
      amount: Number(-amount),
      balanceAfter,
      description,
    });
    await repoManager.save(transactionObj);
  }

  /**
   * Converts a requested sweep coin amount to USD for the specified user.
   *
   * Validates input, checks wallet balance, converts using the fixed
   * sweep-to-dollar rate, and enforces the minimum withdrawable threshold
   * expressed in sweep coins.
   *
   * @param userId - Identifier of the authenticated user
   * @param requestedCoins - Sweep coin amount to convert
   * @returns Object containing the computed dollar amount
   * @throws NotFoundException if the user's wallet is not found
   * @throws BadRequestException for invalid input, insufficient balance,
   *         or when below the minimum withdrawable sweep coin threshold
   */
  async convertSweepCoinsToDollars(
    userId: string,
    requestedCoins: number,
  ): Promise<{ dollars: number }> {
    // Validate input
    if (
      requestedCoins === undefined ||
      requestedCoins === null ||
      isNaN(Number(requestedCoins))
    ) {
      throw new BadRequestException('Invalid coins value');
    }
    if (requestedCoins < 0) {
      throw new BadRequestException('Coins must be non-negative');
    }

    if (!Number.isInteger(requestedCoins)) {
      throw new BadRequestException('Coins must be an integer');
    }

    // Ensure the user's wallet exists and fetch current sweep coin balance
    const wallet = await this.findByUserId(userId);
    const available = Number(wallet.sweepCoins ?? 0);
    if (requestedCoins > available) {
      throw new BadRequestException('Insufficient Stream Coins');
    }

    // Convert using fixed rate and enforce minimum withdrawable in coins
    const dollars = Number(
      (requestedCoins / SWEEP_COINS_PER_DOLLAR).toFixed(2),
    );
    const minCoins = MIN_WITHDRAWABLE_SWEEP_COINS;

    if (requestedCoins < minCoins) {
      throw new BadRequestException(
        `Minimum withdrawable Stream Coins is ${minCoins}`,
      );
    }
    return { dollars };
  }

  /**
   * Computes lifetime USD spent by the user on Coinflow purchases.
   *
   * Strategy:
   *  - Join the transactions table with the coin_packages table on
   *    t.metadata ->> 'coinPackageId' = coin_packages.id.
   *  - Filter for TransactionType.PURCHASE originating from Coinflow (metadata.source = 'coinflow').
   *  - Sum coin_packages.total_amount (USD) for the authenticated user.
   *
   * @param userId - ID of the user
   * @param manager - Optional EntityManager
   * @returns Total lifetime USD spent via Coinflow
   */
  async getLifetimeSpentUSDFromCoinflow(
    userId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager
      ? manager.getRepository(Transaction)
      : this.transactionsRepository;

    const { sum } = await repo
      .createQueryBuilder('t')
      // Cast cp.id to text to match JSONB extracted text to avoid uuid=text operator issues
      .leftJoin(
        'coin_packages',
        'cp',
        "cp.id::text = (t.metadata->>'coinPackageId')",
      )
      .select(
        "COALESCE(SUM(COALESCE((t.metadata->>'usdAmount')::numeric, cp.total_amount, 0)), 0)",
        'sum',
      )
      .where('t.userId = :userId', { userId })
      .andWhere('t.type = :type', { type: TransactionType.PURCHASE })
      .andWhere("(t.metadata->>'source') = :source", { source: 'coinflow' })
      .getRawOne<{ sum: string | number }>();

    return Number(sum ?? 0);
  }

  /**
   * Calculates how much USD the user can still spend given a lifetime cap.
   *
   * @param userId - The user ID
   * @param capUSD - The lifetime spending cap in USD
   * @param manager - Optional EntityManager
   * @returns Object containing spentUSD, remainingUSD, and capUSD
   */
  async getLifetimeRemainingUSDFromCap(
    userId: string,
    capUSD: number,
    manager?: EntityManager,
  ): Promise<{ spentUSD: number; remainingUSD: number; capUSD: number }> {
    const spentUSD = await this.getLifetimeSpentUSDFromCoinflow(userId, manager);
    const remainingUSD = Math.max(0, Number(capUSD) - Number(spentUSD));
    return { spentUSD, remainingUSD, capUSD: Number(capUSD) };
  }
}
