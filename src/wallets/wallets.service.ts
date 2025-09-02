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
import {
  Transaction,
  TransactionType,
  CurrencyType,
} from './entities/transaction.entity';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { TransactionFilterDto } from './dto/transaction.list.dto';
import { HistoryType } from 'src/enums/history-type.enum';

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
          throw new BadRequestException('Insufficient sweep coins');
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
          throw new BadRequestException('Insufficient sweep coins');
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

  async hasTransactionForRelatedEntity(
    relatedEntityId: string,
    relatedEntityType?: string,
    currencyType?: CurrencyType,
    manager?: EntityManager,
  ): Promise<boolean> {
    const where: any = { relatedEntityId };
    if (relatedEntityType) where.relatedEntityType = relatedEntityType;
    if (currencyType) where.currencyType = currencyType;
    where.type = TransactionType.PURCHASE;
    if (manager) {
      const count = await manager.getRepository(Transaction).count({ where });
      return count > 0;
    }
    const count = await this.transactionsRepository.count({ where });
    return count > 0;
  }

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

  private async createTransaction(
    transactionData: Partial<Transaction>,
  ): Promise<Transaction> {
    const transaction = this.transactionsRepository.create(transactionData);
    return this.transactionsRepository.save(transaction);
  }
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
    }

    return await this.findByUserId(userId);
  }
  async walletDetailsByUserId(userId: string) {
    return await this.walletsRepository.findOne({
      where: { userId },
    });
  }

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
}
