import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import {
  Transaction,
  TransactionType,
  CurrencyType,
} from './entities/transaction.entity';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { TransactionFilterDto } from './dto/transaction.list.dto';

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
      TransactionType.REFUND,
      description,
    );
  }

  async addStreamCoins(
    userId: string,
    amount: number,
    description: string,
    type: string,
  ): Promise<Wallet> {
    let addType = TransactionType.PURCHASE;
    if (type === 'refund') {
      addType = TransactionType.REFUND;
    }
    return this.updateBalance(
      userId,
      amount,
      CurrencyType.STREAM_COINS,
      addType,
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
        newBalance = Number(wallet.freeTokens) + Number(amount);
        if (newBalance < 0) {
          throw new BadRequestException('Insufficient free tokens');
        }
        wallet.freeTokens = Number(newBalance);
      } else {
        newBalance = Number(wallet.streamCoins) + Number(amount);
        if (newBalance < 0) {
          throw new BadRequestException('Insufficient stream coins');
        }
        wallet.streamCoins = Number(newBalance);
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

      const { pagination = true, currencyType } = transactionFilterDto;

      const transactionQB = this.transactionsRepository
        .createQueryBuilder('t')
        .where('t.userId = :userId', { userId });
      transactionQB.andWhere('t.type NOT IN (:...excludedTypes)', {
        excludedTypes: [TransactionType.REFUND, TransactionType.BET_PLACEMENT],
      });
      if (filter?.q) {
        transactionQB.andWhere(`(LOWER(t.description) ILIKE LOWER(:q) )`, {
          q: `%${filter.q}%`,
        });
      }
      if (currencyType) {
        transactionQB.andWhere(`t.currencyType = :currencyType`, {
          currencyType,
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
  async updateFreeTokensByAdmin(
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

    if (currencyType === CurrencyType.FREE_TOKENS) {
      await this.walletsRepository.update(wallet.id, { freeTokens: amount });
      const addedAmount = amount - wallet.freeTokens;

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
  ) {
    const wallet = await this.walletsRepository.findOne({
      where: { userId },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet for user with ID ${userId} not found`,
      );
    }

    const balanceAfter =
      currencyType === CurrencyType.FREE_TOKENS
        ? wallet.freeTokens
        : wallet.streamCoins;
    const transactionObj = this.transactionsRepository.create({
      userId,
      type: transactionType,
      currencyType,
      amount,
      balanceAfter,
      description,
    });
    await this.transactionsRepository.save(transactionObj);
  }
}
