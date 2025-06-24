import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not } from 'typeorm';
import {
  BettingVariable,
  BettingVariableStatus,
} from './entities/betting-variable.entity';
import { Bet, BetStatus } from './entities/bet.entity';
import { WalletsService } from '../wallets/wallets.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { CreateBettingVariableDto } from './dto/create-betting-variable.dto';
import { PlaceBetDto } from './dto/place-bet.dto';
import { CurrencyType } from '../wallets/entities/transaction.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { Stream, StreamStatus } from 'src/stream/entities/stream.entity';

@Injectable()
export class BettingService {
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
    @InjectRepository(BettingVariable)
    private bettingVariablesRepository: Repository<BettingVariable>,
    @InjectRepository(Bet)
    private betsRepository: Repository<Bet>,
    private walletsService: WalletsService,
    private dataSource: DataSource,
  ) {}

  // Stream Management
  async createStream(createStreamDto: CreateStreamDto): Promise<Stream> {
    const stream = this.streamsRepository.create(createStreamDto);
    return this.streamsRepository.save(stream);
  }

  async findAllStreams(includeEnded: boolean = false): Promise<Stream[]> {
    if (includeEnded) {
      return this.streamsRepository.find({
        relations: ['bettingVariables'],
        order: { createdAt: 'DESC' },
      });
    }

    return this.streamsRepository.find({
      where: { status: StreamStatus.LIVE },
      relations: ['bettingVariables'],
      order: { createdAt: 'DESC' },
    });
  }

  async findStreamById(id: string): Promise<Stream> {
    const stream = await this.streamsRepository.findOne({
      where: { id },
      relations: ['bettingVariables'],
    });

    if (!stream) {
      throw new NotFoundException(`Stream with ID ${id} not found`);
    }

    return stream;
  }

  async updateStreamStatus(id: string, status: StreamStatus): Promise<Stream> {
    const stream = await this.findStreamById(id);
    stream.status = status;

    if (status === StreamStatus.LIVE) {
      stream.actualStartTime = new Date();
    } else if (status === StreamStatus.ENDED) {
      stream.endTime = new Date();
    }

    return this.streamsRepository.save(stream);
  }

  // Betting Variable Management
  async createBettingVariable(
    createBettingVariableDto: CreateBettingVariableDto,
  ): Promise<BettingVariable> {
    const { streamId } = createBettingVariableDto;
    const stream = await this.findStreamById(streamId);

    if (stream.status === StreamStatus.ENDED) {
      throw new BadRequestException(
        'Cannot add betting variables to ended streams',
      );
    }

    const bettingVariable = this.bettingVariablesRepository.create(
      createBettingVariableDto,
    );
    return this.bettingVariablesRepository.save(bettingVariable);
  }

  async findBettingVariableById(id: string): Promise<BettingVariable> {
    const bettingVariable = await this.bettingVariablesRepository.findOne({
      where: { id },
      relations: ['stream', 'bets'],
    });

    if (!bettingVariable) {
      throw new NotFoundException(`Betting variable with ID ${id} not found`);
    }

    return bettingVariable;
  }

  async updateBettingVariableStatus(
    id: string,
    status: BettingVariableStatus,
  ): Promise<BettingVariable> {
    const bettingVariable = await this.findBettingVariableById(id);
    bettingVariable.status = status;
    return this.bettingVariablesRepository.save(bettingVariable);
  }

  // Betting Operations
  async placeBet(userId: string, placeBetDto: PlaceBetDto): Promise<Bet> {
    const { bettingVariableId, amount, currencyType } = placeBetDto;

    // Find the betting variable
    const bettingVariable = await this.bettingVariablesRepository.findOne({
      where: { id: bettingVariableId },
      relations: ['stream'],
    });

    if (!bettingVariable) {
      throw new NotFoundException(
        `Betting variable with ID ${bettingVariableId} not found`,
      );
    }

    // Check if betting is still open
    if (bettingVariable.status !== BettingVariableStatus.ACTIVE) {
      throw new BadRequestException('Betting is closed for this option');
    }

    // Check if user already has an active bet (MVP restriction)
    const existingBet = await this.betsRepository.findOne({
      where: { userId, status: BetStatus.ACTIVE },
    });

    if (existingBet) {
      throw new BadRequestException(
        'You already have an active bet. Wait for it to resolve before placing a new one.',
      );
    }

    // Create the bet in a transaction to ensure consistency
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Deduct the amount from the wallet
      await this.walletsService.deductForBet(
        userId,
        amount,
        currencyType,
        `Bet on ${bettingVariable.name} in stream ${bettingVariable.stream.name}`,
      );

      // Create and save the bet
      const bet = this.betsRepository.create({
        userId,
        bettingVariableId,
        amount,
      });

      const savedBet = await this.betsRepository.save(bet);

      // Update the betting variable's statistics
      bettingVariable.totalBetsAmount += amount;
      bettingVariable.betCount += 1;
      await this.bettingVariablesRepository.save(bettingVariable);

      // Commit the transaction
      await queryRunner.commitTransaction();

      return savedBet;
    } catch (error) {
      // Rollback in case of error
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }

  async cancelBet(userId: string, betId: string): Promise<Bet> {
    const bet = await this.betsRepository.findOne({
      where: { id: betId, userId },
      relations: ['bettingVariable'],
    });

    if (!bet) {
      throw new NotFoundException(`Bet with ID ${betId} not found`);
    }

    if (bet.status !== BetStatus.ACTIVE) {
      throw new BadRequestException('Only active bets can be canceled');
    }

    if (bet.bettingVariable.status !== BettingVariableStatus.ACTIVE) {
      throw new BadRequestException('Betting is locked or already resolved');
    }

    // Cancel the bet in a transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Refund the amount to the wallet
      await this.walletsService.addFreeTokens(
        userId,
        bet.amount,
        `Refund for canceled bet on ${bet.bettingVariable.name}`,
      );

      // Update the bet status
      bet.status = BetStatus.CANCELED;
      await this.betsRepository.save(bet);

      // Update the betting variable's statistics
      const bettingVariable = bet.bettingVariable;
      bettingVariable.totalBetsAmount -= bet.amount;
      bettingVariable.betCount -= 1;
      await this.bettingVariablesRepository.save(bettingVariable);

      // Commit the transaction
      await queryRunner.commitTransaction();

      return bet;
    } catch (error) {
      // Rollback in case of error
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }

  // Result Declaration and Payout
  async declareWinner(
    adminId: string,
    variableId: string,
    user: User,
  ): Promise<void> {
    // Check if user is admin
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can declare winners');
    }

    const bettingVariable = await this.findBettingVariableById(variableId);

    if (bettingVariable.status !== BettingVariableStatus.LOCKED) {
      throw new BadRequestException(
        'Betting must be locked before declaring a winner',
      );
    }

    // Process in a transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Mark this variable as winner
      bettingVariable.status = BettingVariableStatus.WINNER;
      await queryRunner.manager.save(bettingVariable);

      // Mark all other variables for this stream as losers
      await queryRunner.manager.update(
        BettingVariable,
        {
          streamId: bettingVariable.streamId,
          id: Not(bettingVariable.id),
          status: BettingVariableStatus.LOCKED,
        },
        { status: BettingVariableStatus.LOSER },
      );

      // Get all bets for this stream
      const allStreamBets = await queryRunner.manager.find(Bet, {
        where: {
          bettingVariable: { streamId: bettingVariable.streamId },
          status: BetStatus.ACTIVE,
        },
        relations: ['bettingVariable'],
      });

      // Divide bets into winning and losing bets
      const winningBets = allStreamBets.filter(
        (bet) => bet.bettingVariableId === variableId,
      );

      const losingBets = allStreamBets.filter(
        (bet) => bet.bettingVariableId !== variableId,
      );

      // Calculate total pot and winning pot
      const totalWinningBetsAmount = winningBets.reduce(
        (sum, bet) => sum + bet.amount,
        0,
      );

      const totalLosingBetsAmount = losingBets.reduce(
        (sum, bet) => sum + bet.amount,
        0,
      );

      // Apply 15% vig (platform fee)
      const platformFee = Math.floor(totalLosingBetsAmount * 0.15);
      const distributablePot = totalLosingBetsAmount - platformFee;

      // Process winning bets
      for (const bet of winningBets) {
        // Calculate payout using parimutuel system
        const share = bet.amount / totalWinningBetsAmount;
        const payout = Math.floor(distributablePot * share) + bet.amount; // Return original bet + share of losers' pot

        // Update bet status and payout
        bet.status = BetStatus.WON;
        bet.payoutAmount = payout;
        bet.processedAt = new Date();
        bet.isProcessed = true;
        await queryRunner.manager.save(bet);

        // Credit the user's wallet
        await this.walletsService.creditWinnings(
          bet.userId,
          payout,
          CurrencyType.FREE_TOKENS, // MVP uses free tokens
          `Winnings from bet on ${bettingVariable.name}`,
        );
      }

      // Process losing bets
      for (const bet of losingBets) {
        // Update bet status
        bet.status = BetStatus.LOST;
        bet.payoutAmount = 0;
        bet.processedAt = new Date();
        bet.isProcessed = true;
        await queryRunner.manager.save(bet);
      }

      // Commit the transaction
      await queryRunner.commitTransaction();
    } catch (error) {
      // Rollback in case of error
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }

  // Utility Methods
  async lockBetting(variableId: string): Promise<BettingVariable> {
    return this.updateBettingVariableStatus(
      variableId,
      BettingVariableStatus.LOCKED,
    );
  }

  async getUserBets(userId: string, active: boolean = false): Promise<Bet[]> {
    const whereClause: Record<string, unknown> = { userId };

    if (active) {
      whereClause.status = BetStatus.ACTIVE;
    }

    return this.betsRepository.find({
      where: whereClause,
      relations: ['bettingVariable', 'bettingVariable.stream'],
      order: { createdAt: 'DESC' },
    });
  }

  async getStreamBets(streamId: string): Promise<BettingVariable[]> {
    return this.bettingVariablesRepository.find({
      where: { streamId },
      relations: ['bets'],
    });
  }
}
