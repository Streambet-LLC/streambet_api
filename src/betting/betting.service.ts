import {
  Injectable,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not } from 'typeorm';
import { BettingVariable } from './entities/betting-variable.entity';
import { Bet } from './entities/bet.entity';
import { BettingVariableStatus } from '../enums/betting-variable-status.enum';
import { BetStatus } from '../enums/bet-status.enum';
import { WalletsService } from '../wallets/wallets.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import {
  CreateBettingVariableDto,
  EditBettingVariableDto,
  EditOptionDto,
} from './dto/create-betting-variable.dto';
import { EditBetDto, PlaceBetDto } from './dto/place-bet.dto';
import {
  CurrencyType,
  TransactionType,
} from '../wallets/entities/transaction.entity';
import { Stream, StreamStatus } from 'src/stream/entities/stream.entity';
import { PlatformName } from '../enums/platform-name.enum';
import { BettingRound } from './entities/betting-round.entity';
import { CancelBetDto } from './dto/cancel-bet.dto';
import { BettingRoundStatus } from 'src/enums/round-status.enum';
import { BettingGateway } from './betting.gateway';
import { UsersService } from 'src/users/users.service';
import { StreamService } from 'src/stream/stream.service';
import { NotificationService } from 'src/notification/notification.service';
import { StreamList } from 'src/enums/stream-list.enum';

@Injectable()
export class BettingService {
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
    @InjectRepository(BettingVariable)
    private bettingVariablesRepository: Repository<BettingVariable>,
    @InjectRepository(BettingRound)
    private bettingRoundsRepository: Repository<BettingRound>,
    @InjectRepository(Bet)
    private betsRepository: Repository<Bet>,
    private walletsService: WalletsService,
    private notificationService: NotificationService,
    private usersService: UsersService,
    private dataSource: DataSource,
    @Inject(forwardRef(() => BettingGateway))
    private readonly bettingGateway: BettingGateway,
    private readonly streamService: StreamService,
  ) {}

  // Utility function to detect platform from URL
  private detectPlatformFromUrl(url: string): PlatformName | null {
    const platformKeywords: Record<PlatformName, string[]> = {
      [PlatformName.Kick]: ['kick.com', 'kick'],
      [PlatformName.Youtube]: ['youtube.com', 'youtu.be', 'youtube'],
      [PlatformName.Twitch]: ['twitch.tv', 'twitch.com', 'twitch'],
      [PlatformName.Vimeo]: ['vimeo.com', 'vimeo'],
    };
    const urlLower = url.toLowerCase();
    for (const [platform, keywords] of Object.entries(platformKeywords)) {
      if (keywords.some((keyword) => urlLower.includes(keyword))) {
        return platform as PlatformName;
      }
    }
    return null;
  }

  // Stream Management
  async createStream(createStreamDto: CreateStreamDto): Promise<Stream> {
    const stream = this.streamsRepository.create(createStreamDto);

    if (createStreamDto.scheduledStartTime) {
      const now = new Date();
      const scheduledTime = new Date(createStreamDto.scheduledStartTime);

      if (scheduledTime <= now) {
        stream.status = StreamStatus.LIVE; // If scheduled time is now or in the past
      } else {
        stream.status = StreamStatus.SCHEDULED;
      }
    }

    // Auto-detect platform from embeddedUrl if provided
    if (createStreamDto.embeddedUrl) {
      const detectedPlatform = this.detectPlatformFromUrl(
        createStreamDto.embeddedUrl,
      );
      if (detectedPlatform) {
        stream.platformName = detectedPlatform;
      }
    }

    const streamResponse = await this.streamsRepository.save(stream);
    if (stream.status == StreamStatus.SCHEDULED) {
      this.streamService.scheduleStream(
        streamResponse.id,
        stream.scheduledStartTime,
      );
    }

    // Emit event to update stream list
    this.bettingGateway.emitStreamListEvent(StreamList.StreamCreated);
    return streamResponse;
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
  ): Promise<any> {
    const { streamId, rounds } = createBettingVariableDto;
    const stream = await this.findStreamById(streamId);

    if (stream.status === StreamStatus.ENDED) {
      throw new BadRequestException(
        'Cannot add betting variables to ended streams',
      );
    }

    const allRounds = [];

    for (const roundData of rounds) {
      // Create betting round
      const bettingRound = this.bettingRoundsRepository.create({
        roundName: roundData.roundName,
        stream: stream,
        status: BettingRoundStatus.CREATED,
      });
      const savedRound = await this.bettingRoundsRepository.save(bettingRound);

      const createdVariables: BettingVariable[] = [];

      // Create betting variables for this round
      for (const option of roundData.options) {
        const bettingVariable = this.bettingVariablesRepository.create({
          name: option.option,
          round: savedRound,
          stream: stream,
        });
        const saved =
          await this.bettingVariablesRepository.save(bettingVariable);
        createdVariables.push(saved);
      }

      allRounds.push({
        roundId: savedRound.id,
        roundName: savedRound.roundName,
        status: savedRound.status,
        options: createdVariables.map((variable) => ({
          id: variable.id,
          name: variable.name,
          is_winning_option: variable.is_winning_option,
          status: variable.status,
          totalBetsTokenAmount: variable.totalBetsTokenAmount,
          totalBetsCoinAmount: variable.totalBetsCoinAmount,
          betCountFreeToken: variable.betCountFreeToken,
          betCountCoin: variable.betCountCoin,
        })),
      });
    }

    return {
      streamId,
      rounds: allRounds,
    };
  }

  async findBettingVariableById(id: string): Promise<BettingVariable> {
    const bettingVariable = await this.bettingVariablesRepository.findOne({
      where: { id },
      relations: ['stream', 'bets', 'round'],
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
    const updatedVariable =
      await this.bettingVariablesRepository.save(bettingVariable);

    return updatedVariable;
  }

  async editBettingVariable(
    editBettingVariableDto: EditBettingVariableDto,
  ): Promise<any> {
    const { streamId, rounds } = editBettingVariableDto;
    const stream = await this.findStreamById(streamId);

    if (stream.status === StreamStatus.ENDED) {
      throw new BadRequestException(
        'Cannot edit betting variables for ended streams',
      );
    }
    if (stream.status === StreamStatus.CANCELLED) {
      throw new BadRequestException(
        'Cannot edit betting variables for cancelled streams',
      );
    }
    // Get existing rounds for this stream
    const existingRounds = await this.bettingRoundsRepository.find({
      where: { streamId },
      relations: ['bettingVariables'],
      order: { createdAt: 'ASC' },
    });

    const allRounds = [];

    for (const roundData of rounds) {
      // Find existing round by roundId
      let bettingRound = roundData.roundId
        ? existingRounds.find((r) => r.id === roundData.roundId)
        : undefined;

      if (bettingRound) {
        // Update existing round
        bettingRound.roundName = roundData.roundName;
        await this.bettingRoundsRepository.save(bettingRound);
      } else {
        // Create new round
        bettingRound = this.bettingRoundsRepository.create({
          roundName: roundData.roundName,
          stream: stream,
          status: BettingRoundStatus.CREATED,
        });
        bettingRound = await this.bettingRoundsRepository.save(bettingRound);
      }

      // Update options for this round
      const updatedRound = await this.updateRoundOptions(
        bettingRound,
        roundData.options,
      );
      allRounds.push(updatedRound);
    }

    // Remove rounds that are not in the request (by roundId)
    const roundIdsToKeep = rounds
      .filter((r) => r.roundId)
      .map((r) => r.roundId);
    const roundsToDelete = existingRounds.filter(
      (r) => !roundIdsToKeep.includes(r.id),
    );

    for (const round of roundsToDelete) {
      await this.bettingVariablesRepository.remove(round.bettingVariables);
      await this.bettingRoundsRepository.remove(round);
    }

    // Sort allRounds by createdAt ASC
    allRounds.sort((a, b) => {
      const roundA = existingRounds.find((r) => r.id === a.roundId);
      const roundB = existingRounds.find((r) => r.id === b.roundId);
      if (!roundA || !roundB) return 0;
      return (
        new Date(roundA.createdAt).getTime() -
        new Date(roundB.createdAt).getTime()
      );
    });

    return {
      streamId,
      rounds: allRounds,
    };
  }

  private async updateRoundOptions(
    bettingRound: BettingRound,
    options: EditOptionDto[],
  ): Promise<any> {
    {
      const existingVariables = await this.bettingVariablesRepository.find({
        where: { roundId: bettingRound.id },
      });

      // Separate existing and new options by id
      const existingOptions = options.filter((opt) => opt.id);
      const newOptions = options.filter((opt) => !opt.id);

      // Update existing options
      for (const option of existingOptions) {
        const existingVariable = existingVariables.find(
          (v) => v.id === option.id,
        );
        if (existingVariable) {
          existingVariable.name = option.option;
          await this.bettingVariablesRepository.save(existingVariable);
        }
      }

      // Ensure bettingRound.stream is populated
      if (!bettingRound.stream) {
        const roundWithStream = await this.bettingRoundsRepository.findOne({
          where: { id: bettingRound.id },
          relations: ['stream'],
        });
        bettingRound.stream = roundWithStream?.stream;
      }

      // Add new options
      for (const option of newOptions) {
        const bettingVariable = this.bettingVariablesRepository.create({
          name: option.option,
          round: bettingRound,
          stream: bettingRound.stream,
          streamId: bettingRound.stream?.id, // Ensure streamId is set
        });
        await this.bettingVariablesRepository.save(bettingVariable);
      }

      // Remove options that are not in the request (by id)
      const optionIdsToKeep = existingOptions.map((opt) => opt.id as string);
      const variablesToDelete = existingVariables.filter(
        (v) => v.id && !optionIdsToKeep.includes(v.id),
      );

      for (const variable of variablesToDelete) {
        await this.bettingVariablesRepository.remove(variable);
      }

      // Get updated variables
      const updatedVariables = await this.bettingVariablesRepository.find({
        where: { roundId: bettingRound.id },
        order: { createdAt: 'ASC' },
      });

      return {
        roundId: bettingRound.id,
        roundName: bettingRound.roundName,
        status: bettingRound.status,
        options: updatedVariables.map((variable) => ({
          id: variable.id,
          name: variable.name,
          is_winning_option: variable.is_winning_option,
          status: variable.status,
          totalBetsCoinAmount: variable.totalBetsCoinAmount,
          totalBetsTokenAmount: variable.totalBetsTokenAmount,
          betCountCoin: variable.betCountCoin,
          betCountFreeToken: variable.betCountFreeToken,
        })),
      };
    }
  }

  // Betting Operations
  async placeBet(
    userId: string,
    placeBetDto: PlaceBetDto,
  ): Promise<{ bet: Bet; roundId: string }> {
    const { bettingVariableId, amount, currencyType } = placeBetDto;
    const bettingVariable = await this.bettingVariablesRepository.findOne({
      where: { id: bettingVariableId },
      relations: ['round', 'round.stream'],
    });
    if (!bettingVariable) {
      throw new NotFoundException(
        `Could not find an active betting variable with the specified ID. Please check the ID and try again.`,
      );
    }

    if (bettingVariable?.round?.status !== BettingRoundStatus.OPEN) {
      const message = await this.bettingRoundStatusMessage(
        bettingVariable.round.status,
      );
      throw new BadRequestException(message);
    }
    if (bettingVariable?.round?.stream?.status === StreamStatus.ENDED) {
      throw new BadRequestException(
        `This stream is Ended. You can only place bets during live and scheduled streams.`,
      );
    }
    const existingBet = await this.betsRepository
      .createQueryBuilder('bet')
      .where('bet.userId = :userId', { userId })
      .andWhere('bet.status = :status', { status: BetStatus.Active })
      .andWhere('bet.roundId = :roundId', {
        roundId: bettingVariable?.round?.id,
      })
      .getOne();

    if (existingBet) {
      throw new BadRequestException(
        'You already have an active bet. Wait for it to resolve before placing a new one.',
      );
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let roundIdToUpdate: string | null = null;
    try {
      await this.walletsService.deductForBet(
        userId,
        amount,
        currencyType,
        `Bet ${amount} on "${bettingVariable.name}" for stream "${bettingVariable.round.stream.name}" (Round ${bettingVariable.round.roundName})`,
      );
      const bet = this.betsRepository.create({
        userId,
        bettingVariableId,
        amount,
        currency: currencyType,
        stream: { id: bettingVariable.streamId },
        roundId: bettingVariable.roundId,
      });
      const savedBet = await queryRunner.manager.save(bet);
      if (currencyType === CurrencyType.FREE_TOKENS) {
        bettingVariable.totalBetsTokenAmount =
          Number(bettingVariable.totalBetsTokenAmount) + Number(amount);
        bettingVariable.betCountFreeToken += 1;
      } else if (currencyType === CurrencyType.STREAM_COINS) {
        bettingVariable.totalBetsCoinAmount =
          Number(bettingVariable.totalBetsCoinAmount) + Number(amount);
        bettingVariable.betCountCoin += 1;
      }
      await queryRunner.manager.save(bettingVariable);
      roundIdToUpdate = bettingVariable.roundId;
      await queryRunner.commitTransaction();
      return { bet: savedBet, roundId: roundIdToUpdate };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
  async editBet(userId: string, editBetDto: EditBetDto) {
    const { newCurrencyType, newAmount, newBettingVariableId, betId } =
      editBetDto;

    const betDetails = await this.betsRepository.findOne({
      where: { id: betId, userId }, // Add userId for security
    });

    if (!betDetails) {
      throw new NotFoundException(`Unable to find the selected bet.`);
    }

    if (betDetails.status !== BetStatus.Active) {
      const message = await this.bettingStatusMessage(betDetails.status);
      throw new BadRequestException(message);
    }

    const bettingVariable = await this.bettingVariablesRepository.findOne({
      where: { id: newBettingVariableId },
      relations: ['round', 'round.stream'],
    });

    if (!bettingVariable) {
      throw new NotFoundException(
        `Betting variable with ID ${newBettingVariableId} not found`,
      );
    }

    if (bettingVariable.round.status !== BettingRoundStatus.OPEN) {
      const message = await this.bettingRoundStatusMessage(
        bettingVariable.round.status,
      );
      throw new BadRequestException(message);
    }

    if (bettingVariable.round.stream.status === StreamStatus.ENDED) {
      throw new BadRequestException(
        `This stream is ended. You can only place bets during live or scheduled streams.`,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let roundIdToUpdate: string | null = null;
    try {
      // Handle wallet operations for currency/amount changes
      const amountDiff = Number(newAmount) - Number(betDetails.amount);

      if (amountDiff > 0) {
        await this.walletsService.deductForBet(
          userId,
          amountDiff,
          newCurrencyType,
          `Additional bet amount for edit: ${amountDiff}`,
        );
      } else if (amountDiff < 0) {
        // Refund difference
        const refundAmount = Math.abs(amountDiff);
        if (betDetails.currency === CurrencyType.FREE_TOKENS) {
          await this.walletsService.addFreeTokens(
            userId,
            refundAmount,
            `Refund from bet edit: ${refundAmount}`,
          );
        } else {
          await this.walletsService.addStreamCoins(
            userId,
            refundAmount,
            `Refund from bet edit: ${refundAmount}`,
            'refund',
          );
        }
      }

      // Update betting variable statistics
      const oldBettingVariable = await this.bettingVariablesRepository.findOne({
        where: { id: betDetails.bettingVariableId },
      });

      const isSameOption = oldBettingVariable.id === bettingVariable.id;

      // Update totals correctly for same or different option
      if (betDetails.currency === CurrencyType.FREE_TOKENS) {
        if (isSameOption) {
          bettingVariable.totalBetsTokenAmount =
            Number(bettingVariable.totalBetsTokenAmount) -
            Number(betDetails.amount) +
            Number(newAmount);
        } else {
          oldBettingVariable.totalBetsTokenAmount =
            Number(oldBettingVariable.totalBetsTokenAmount) -
            Number(betDetails.amount);
          bettingVariable.totalBetsTokenAmount =
            Number(bettingVariable.totalBetsTokenAmount) + Number(newAmount);
        }
        if (!isSameOption) {
          oldBettingVariable.betCountFreeToken -= 1;
          bettingVariable.betCountFreeToken += 1;
        }
      } else {
        if (isSameOption) {
          bettingVariable.totalBetsCoinAmount =
            Number(bettingVariable.totalBetsCoinAmount) -
            Number(betDetails.amount) +
            Number(newAmount);
        } else {
          oldBettingVariable.totalBetsCoinAmount =
            Number(oldBettingVariable.totalBetsCoinAmount) -
            Number(betDetails.amount);
          bettingVariable.totalBetsCoinAmount =
            Number(bettingVariable.totalBetsCoinAmount) + Number(newAmount);
        }
        if (!isSameOption) {
          oldBettingVariable.betCountCoin -= 1;
          bettingVariable.betCountCoin += 1;
        }
      }

      // Update the bet
      betDetails.amount = newAmount;
      betDetails.currency = newCurrencyType;
      betDetails.bettingVariableId = newBettingVariableId;
      betDetails.roundId = bettingVariable.roundId;

      // Save all changes
      await queryRunner.manager.save(betDetails);
      await queryRunner.manager.save(oldBettingVariable);
      await queryRunner.manager.save(bettingVariable);

      roundIdToUpdate = bettingVariable.roundId;
      await queryRunner.commitTransaction();
      return betDetails;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
    // Emit after transaction and release
    if (roundIdToUpdate) {
      await this.bettingGateway.emitPotentialAmountsUpdate(roundIdToUpdate);
    }
  }

  async cancelBet(userId: string, cancelBetDto: CancelBetDto): Promise<Bet> {
    const { betId } = cancelBetDto;
    const bet = await this.betsRepository.findOne({
      where: { id: betId, userId },
      relations: ['stream'],
    });

    if (!bet) {
      throw new NotFoundException(
        `The bet with ID '${betId}' was not found. It may have been cancelled or removed.`,
      );
    }
    if (bet.status !== BetStatus.Active) {
      const message = await this.bettingStatusMessage(bet.status);
      throw new BadRequestException(message);
    }
    const bettingRound = await this.bettingRoundsRepository
      .createQueryBuilder('round')
      .leftJoinAndSelect(
        'round.bettingVariables',
        'variable',
        'variable.id = :variableId',
        { variableId: bet.bettingVariableId },
      )
      .where('round.id = :roundId', { roundId: bet.roundId })
      .getOne();

    if (bettingRound.status !== BettingRoundStatus.OPEN) {
      throw new BadRequestException('This round is closed for betting.');
    }
    const data = { bettingRound, bet };
    return await this.handleCancelBet(userId, data, bet.currency);
  }

  private async bettingRoundStatusMessage(status: string) {
    let message: string;
    switch (status) {
      case BettingVariableStatus.CANCELLED:
        message = `This bet round has already been cancelled and cannot be processed again.`;
        break;
      case BettingVariableStatus.CREATED:
        message = `This betting round has been created but is not yet open for wagers.`;
        break;
      case BettingVariableStatus.LOCKED:
        message = `This bet round has already been locked and cannot be processed again.`;
        break;
      case BettingVariableStatus.LOSER:
        message = `The result for this bet has already been announced.`;
        break;
      case BettingVariableStatus.WINNER:
        message = `The result for this bet round has already been announced.`;
        break;
      default:
        message = `We cannot proceed with your request because this bet Variable is not currently active.`;
    }
    return message;
  }
  private async bettingStatusMessage(status: string) {
    let message: string;
    switch (status) {
      case BetStatus.Cancelled:
        message = `This bet has already been cancelled and cannot be processed again.`;
        break;
      case BetStatus.Pending:
        message = `This bet status is pending and cannot be processed`;
        break;
      case BetStatus.Lost:
        message = `The result for this bet has already been announced.`;
        break;
      case BetStatus.Won:
        message = `The result for this bet has already been announced.`;
        break;
      default:
        message = `We cannot proceed with your request because this bet is not currently active.`;
    }
    return message;
  }
  private async handleCancelBet(
    userId: string,
    data: any,
    currencyType: CurrencyType,
  ): Promise<Bet> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { bettingRound, bet } = data;

      const bettingVariable = bettingRound.bettingVariables.find(
        (variable) => variable.id === bet.bettingVariableId,
      );

      if (!bettingVariable) {
        throw new NotFoundException('Betting variable not found for this bet');
      }

      const amount = Number(bet.amount);
      const refundMessage = `Refund ${Number(bet.amount)} for canceled bet on ${bettingVariable.name} in stream ${bet.stream.name}(${bettingRound.roundName})`;

      if (currencyType === CurrencyType.FREE_TOKENS) {
        await this.walletsService.addFreeTokens(
          userId,
          bet.amount,
          refundMessage,
        );
        bettingVariable.totalBetsTokenAmount =
          Number(bettingVariable.totalBetsTokenAmount) - amount;
        bettingVariable.betCountFreeToken -= 1;
      } else {
        await this.walletsService.addStreamCoins(
          userId,
          bet.amount,
          refundMessage,
          'refund',
        );
        bettingVariable.totalBetsCoinAmount =
          Number(bettingVariable.totalBetsCoinAmount) - amount;
        bettingVariable.betCountCoin -= 1;
      }

      // Update bet status
      bet.status = BetStatus.Cancelled;

      // Save changes within transaction
      await queryRunner.manager.save(bet);
      await queryRunner.manager.save(bettingVariable);

      await queryRunner.commitTransaction();
      return bet;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // Result Declaration and Payout
  async declareWinner(variableId: string): Promise<void> {
    const bettingVariable = await this.findBettingVariableById(variableId);

    this.validateRoundLocked(bettingVariable);

    // Process in a transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await this.markWinnerAndLosers(queryRunner, bettingVariable);

      const allStreamBets = await this.fetchActiveBets(
        queryRunner,
        bettingVariable,
      );

      // Check if there are any active bets
      if (!allStreamBets || allStreamBets.length === 0) {
        console.log('No active bets found for this round');
        await this.closeRound(queryRunner, bettingVariable);
        await queryRunner.commitTransaction();
        // Emit winner declared event even if no bets (optional)
        this.bettingGateway.emitWinnerDeclared(
          bettingVariable.stream.id,
          bettingVariable.id,
          bettingVariable.name,
          [], // No winners
        );
        return;
      }

      const {
        winningBets,
        losingBets,
        winningTokenBets,
        winningCoinBets,
        losingTokenBets,
        losingCoinBets,
      } = this.splitBets(allStreamBets, variableId);
      const {
        totalWinningTokenAmount,
        totalLosingTokenAmount,
        totalWinningCoinAmount,
        totalLosingCoinAmount,
        coinPlatformFee,
        distributableCoinPot,
      } = this.calculatePots(
        winningTokenBets,
        losingTokenBets,
        winningCoinBets,
        losingCoinBets,
      );

      // Process winning token bets only if there are any
      if (winningTokenBets.length > 0 && totalWinningTokenAmount > 0) {
        await this.processWinningTokenBets(
          queryRunner,
          winningTokenBets,
          totalWinningTokenAmount,
          totalLosingTokenAmount,
          bettingVariable,
        );
      }

      // Process winning coin bets only if there are any
      if (winningCoinBets.length > 0 && totalWinningCoinAmount > 0) {
        await this.processWinningCoinBets(
          queryRunner,
          winningCoinBets,
          totalWinningCoinAmount,
          distributableCoinPot,
          bettingVariable,
          totalLosingCoinAmount,
        );
      }

      // Process losing bets
      if (losingBets.length > 0) {
        await this.processLosingBets(queryRunner, losingBets);
        if (winningTokenBets.length === 0) {
          await this.creditAmountVoidCase(queryRunner, losingTokenBets);
        }
        if (winningCoinBets.length === 0) {
          await this.creditAmountVoidCase(queryRunner, losingCoinBets);
        }
      }

      await this.closeRound(queryRunner, bettingVariable);

      // Fetch winning bets with user info
      const winningBetsWithUserInfo = await queryRunner.manager.find(Bet, {
        where: {
          bettingVariableId: variableId,
          status: BetStatus.Won,
        },
        relations: ['user'],
      });

      const winners = winningBetsWithUserInfo.map((bet) => ({
        userId: bet.userId,
        username: bet.user?.username,
        amount: bet?.payoutAmount,
        currencyType: bet?.currency,
        roundName: bettingVariable?.round?.roundName,
        email: bet.user?.email,
      }));

      await queryRunner.commitTransaction();

      this.bettingGateway.emitWinnerDeclared(
        bettingVariable.stream.id,
        bettingVariable.id,
        bettingVariable.name,
        winners,
      );
      for (const winner of winners) {
        await this.bettingGateway.emitBotMessageToWinner(
          winner.userId,
          winner.username,
          winner.roundName,
          winner.amount,
          winner.currencyType,
        );
        await this.notificationService.sendSMTPForWonBet(
          winner.userId,
          bettingVariable.stream.name,
          winner.amount,
          winner.currencyType,
          winner.roundName,
        );
        //As per client feedback, only one email should be sent to winners (bet_won)
        /*
        if (winner.currencyType === CurrencyType.FREE_TOKENS) {
          await this.notificationService.sendSMTPForWonFreeCoin(
            winner.userId,
            winner.email,
            winner.username,
            bettingVariable.stream.name,
            winner.amount,
            winner.roundName,
          );
        }
          */
      }
      const lossingBetsWithUserInfo = await queryRunner.manager.find(Bet, {
        where: {
          roundId: bettingVariable.roundId,
          status: BetStatus.Lost,
        },
        relations: ['user', 'bettingVariable', 'round'],
      });

      lossingBetsWithUserInfo.map(async (bet) => {
        if (winningCoinBets.length > 0 || winningTokenBets.length > 0) {
          await this.bettingGateway.emitBotMessageToLoser(
            bet.userId,
            bet.user?.username,
            bet.round.roundName,
          );

          await this.notificationService.sendSMTPForLossBet(
            bet.userId,
            bettingVariable.stream.name,
            bet.round.roundName,
          );
        }
      });
    } catch (error) {
      // Rollback in case of error
      await queryRunner.rollbackTransaction();
      console.error('Error in declareWinner:', error);
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }
  private async creditAmountVoidCase(queryRunner, bets) {
    if (!bets || !Array.isArray(bets) || bets.length === 0) {
      console.log('No bets to refund in void case');
      return;
    }

    for (const bet of bets) {
      try {
        if (!bet || !bet.userId || !bet.amount || !bet.currency) {
          console.log('Invalid bet found in void case refund:', bet);
          continue;
        }

        const userId = bet.userId;
        const amount = Number(bet.amount);
        const currency = bet.currency;
        const transactionType = TransactionType.REFUND;
        const description = `${amount} ${currency} refunded - bet round closed with no winners.`;

        await this.walletsService.updateBalance(
          userId,
          amount,
          currency,
          transactionType,
          description,
        );
        const userObj = await this.usersService.findById(userId);
        await this.bettingGateway.emitBotMessageVoidRound(
          userId,
          userObj.username,
          bet?.round?.roundName,
        );
        await queryRunner.manager.save(bet);

        // Update bet status within transaction
      } catch (error) {
        console.error(
          `Error processing void case refund for bet ${bet?.id}:`,
          error,
        );
        throw error;
      }
    }
  }

  private validateRoundLocked(bettingVariable: BettingVariable) {
    if (!bettingVariable) {
      throw new BadRequestException('Betting variable is required');
    }

    if (!bettingVariable.round) {
      throw new BadRequestException(
        'Betting variable must have an associated round',
      );
    }

    if (bettingVariable.round.status === BettingRoundStatus.CLOSED) {
      throw new BadRequestException(
        'This round is already closed. Winner has already been declared for this round.',
      );
    }
    if (bettingVariable.round.status !== BettingRoundStatus.LOCKED) {
      throw new BadRequestException(
        'Betting round must be locked before declaring a winner',
      );
    }
  }

  private async markWinnerAndLosers(
    queryRunner,
    bettingVariable: BettingVariable,
  ) {
    // Mark this variable as winner
    bettingVariable.status = BettingVariableStatus.WINNER;
    bettingVariable.is_winning_option = true;
    await queryRunner.manager.save(bettingVariable);

    // Mark all other variables for this stream as losers
    await queryRunner.manager.update(
      BettingVariable,
      {
        round: { id: bettingVariable.round.id },
        id: Not(bettingVariable.id),
      },
      { status: BettingVariableStatus.LOSER },
    );
  }

  private async fetchActiveBets(queryRunner, bettingVariable: BettingVariable) {
    try {
      if (
        !bettingVariable ||
        !bettingVariable.stream ||
        !bettingVariable.roundId
      ) {
        console.log('Invalid bettingVariable provided to fetchActiveBets');
        return [];
      }

      const bets = await queryRunner.manager.find(Bet, {
        where: {
          bettingVariable: { stream: { id: bettingVariable.stream.id } },
          roundId: bettingVariable.roundId,
          status: BetStatus.Active,
        },
        relations: ['bettingVariable', 'round'],
      });

      // Validate and filter out any invalid bets
      return bets.filter(
        (bet) =>
          bet &&
          bet.id &&
          bet.bettingVariableId &&
          bet.amount !== null &&
          bet.amount !== undefined &&
          bet.currency &&
          bet.round,
      );
    } catch (error) {
      console.error('Error fetching active bets:', error);
      return [];
    }
  }

  private splitBets(allStreamBets, variableId) {
    // Validate inputs
    if (!allStreamBets || !Array.isArray(allStreamBets)) {
      console.log('Invalid allStreamBets input:', allStreamBets);
      return {
        winningBets: [],
        losingBets: [],
        winningTokenBets: [],
        winningCoinBets: [],
        losingTokenBets: [],
        losingCoinBets: [],
      };
    }

    if (!variableId) {
      console.log('Invalid variableId input:', variableId);
      return {
        winningBets: [],
        losingBets: [],
        winningTokenBets: [],
        winningCoinBets: [],
        losingTokenBets: [],
        losingCoinBets: [],
      };
    }

    const winningBets = allStreamBets.filter(
      (bet) => bet && bet.bettingVariableId === variableId,
    );
    const losingBets = allStreamBets.filter(
      (bet) => bet && bet.bettingVariableId !== variableId,
    );
    const winningTokenBets = winningBets.filter(
      (bet) => bet && bet.currency === CurrencyType.FREE_TOKENS,
    );
    const winningCoinBets = winningBets.filter(
      (bet) => bet && bet.currency === CurrencyType.STREAM_COINS,
    );
    const losingTokenBets = losingBets.filter(
      (bet) => bet && bet.currency === CurrencyType.FREE_TOKENS,
    );
    const losingCoinBets = losingBets.filter(
      (bet) => bet && bet.currency === CurrencyType.STREAM_COINS,
    );

    return {
      winningBets,
      losingBets,
      winningTokenBets,
      winningCoinBets,
      losingTokenBets,
      losingCoinBets,
    };
  }

  private calculatePots(
    winningTokenBets,
    losingTokenBets,
    winningCoinBets,
    losingCoinBets,
  ) {
    // Validate inputs and provide defaults
    const safeWinningTokenBets = Array.isArray(winningTokenBets)
      ? winningTokenBets
      : [];
    const safeLosingTokenBets = Array.isArray(losingTokenBets)
      ? losingTokenBets
      : [];
    const safeWinningCoinBets = Array.isArray(winningCoinBets)
      ? winningCoinBets
      : [];
    const safeLosingCoinBets = Array.isArray(losingCoinBets)
      ? losingCoinBets
      : [];

    const totalWinningTokenAmount = safeWinningTokenBets.reduce(
      (sum, bet) => Number(sum) + Number(bet?.amount || 0),
      0,
    );
    const totalLosingTokenAmount = safeLosingTokenBets.reduce(
      (sum, bet) => Number(sum) + Number(bet?.amount || 0),
      0,
    );
    const totalWinningCoinAmount = safeWinningCoinBets.reduce(
      (sum, bet) => Number(sum) + Number(bet?.amount || 0),
      0,
    );
    const totalLosingCoinAmount = safeLosingCoinBets.reduce(
      (sum, bet) => Number(sum) + Number(bet?.amount || 0),
      0,
    );
    const coinPlatformFee = Math.floor(totalLosingCoinAmount * 0.15);
    const distributableCoinPot = totalLosingCoinAmount - coinPlatformFee;

    return {
      totalWinningTokenAmount,
      totalLosingTokenAmount,
      totalWinningCoinAmount,
      totalLosingCoinAmount,
      coinPlatformFee,
      distributableCoinPot,
    };
  }

  private async processWinningTokenBets(
    queryRunner,
    winningTokenBets,
    totalWinningTokenAmount,
    totalLosingTokenAmount,
    bettingVariable,
  ) {
    // Validate inputs to prevent division by zero
    if (
      !winningTokenBets ||
      winningTokenBets.length === 0 ||
      totalWinningTokenAmount <= 0
    ) {
      console.log('No winning token bets to process or invalid total amount');
      return;
    }

    for (const bet of winningTokenBets) {
      try {
        const totalBetForWinningOption =
          bet.bettingVariable?.totalBetsTokenAmount;
        //bet amount placed by user
        const betAmount = bet.amount;

        // payout calculation, Multiply by the total token pool (winning + losing side)

        const payout = Math.floor(
          (betAmount / totalBetForWinningOption) *
            Number(totalWinningTokenAmount + totalLosingTokenAmount),
        );

        bet.status = BetStatus.Won;
        bet.payoutAmount = payout;
        bet.processedAt = new Date();
        bet.isProcessed = true;
        await queryRunner.manager.save(bet);
        await this.walletsService.creditWinnings(
          bet.userId,
          payout,
          CurrencyType.FREE_TOKENS,
          `Winnings from bet on ${bettingVariable.name}`,
        );
      } catch (error) {
        console.error(`Error processing winning token bet ${bet.id}:`, error);
        throw error;
      }
    }
  }

  private async processWinningCoinBets(
    queryRunner,
    winningCoinBets,
    totalWinningCoinAmount,
    distributableCoinPot,
    bettingVariable,
    totalLosingCoinAmount,
  ) {
    // Validate inputs to prevent division by zero
    if (
      !winningCoinBets ||
      winningCoinBets.length === 0 ||
      totalWinningCoinAmount <= 0
    ) {
      console.log('No winning coin bets to process or invalid total amount');
      return;
    }

    for (const bet of winningCoinBets) {
      try {
        const totalBetForWinningOption =
          bet.bettingVariable?.totalBetsCoinAmount;
        //bet amount placed by user
        const betAmount = bet.amount;
        //reduce 15% - platform fee from total streamcoin pot amount
        const potAmountAfterPlatformFee =
          Number(totalWinningCoinAmount + totalLosingCoinAmount) * 0.85;
        //calculation
        let payout =
          (betAmount / totalBetForWinningOption) * potAmountAfterPlatformFee;
        // reduce stream coin, upto 3 decimal place
        payout = Number(payout.toFixed(3));

        bet.status = BetStatus.Won;
        bet.payoutAmount = payout;
        bet.processedAt = new Date();
        bet.isProcessed = true;
        await queryRunner.manager.save(bet);
        await this.walletsService.creditWinnings(
          bet.userId,
          payout,
          CurrencyType.STREAM_COINS,
          `Winnings from bet on ${bettingVariable.name}`,
        );
      } catch (error) {
        console.error(`Error processing winning coin bet ${bet.id}:`, error);
        throw error;
      }
    }
  }

  private async processLosingBets(queryRunner, losingBets) {
    if (!losingBets || !Array.isArray(losingBets) || losingBets.length === 0) {
      console.log('No losing bets to process');
      return;
    }

    for (const bet of losingBets) {
      try {
        if (!bet || !bet.id) {
          console.log('Invalid bet found in losingBets:', bet);
          continue;
        }

        bet.status = BetStatus.Lost;
        bet.payoutAmount = 0;
        bet.processedAt = new Date();
        bet.isProcessed = true;
        await queryRunner.manager.save(bet);
        await this.walletsService.createTransactionData(
          bet.userId,
          TransactionType.BET_LOST,
          bet.currency,
          bet.amount,
          `${bet.amount} ${bet.currency} debited - bet lost.`,
        );
      } catch (error) {
        console.error(`Error processing losing bet ${bet?.id}:`, error);
        throw error;
      }
    }
  }

  private async closeRound(queryRunner, bettingVariable: BettingVariable) {
    let round = bettingVariable.round;
    if (!round) {
      round = await this.bettingRoundsRepository.findOne({
        where: { id: bettingVariable.roundId },
      });
    }
    if (round) {
      round.status = BettingRoundStatus.CLOSED;
      await queryRunner.manager.save(round);
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
    console.log('debug');

    if (active) {
      whereClause.status = BetStatus.Active;
    }

    return this.betsRepository.find({
      where: whereClause,
      relations: ['bettingVariable', 'bettingVariable.stream'],
      order: { createdAt: 'DESC' },
    });
  }

  async getStreamBets(streamId: string): Promise<BettingVariable[]> {
    return this.bettingVariablesRepository.find({
      where: { stream: { id: streamId } },
      relations: ['bets'],
    });
  }

  async getBetById(betId: string): Promise<Bet> {
    const bet = await this.betsRepository.findOne({
      where: { id: betId },
      relations: ['bettingVariable', 'bettingVariable.round', 'stream'],
    });

    if (!bet) {
      throw new NotFoundException(`Bet with ID ${betId} not found`);
    }

    return bet;
  }

  async findPotentialAmount(userId: string, roundId: string) {
    try {
      const bettingRound = await this.bettingRoundsRepository.findOne({
        where: {
          id: roundId,
        },
        relations: ['bettingVariables'],
      });

      const bets = await this.betsRepository
        .createQueryBuilder('bet')
        .leftJoin('bet.bettingVariable', 'bettingVariable')
        .leftJoin('bettingVariable.round', 'round')
        .where('bet.userId = :userId', { userId })
        .andWhere('round.id = :roundId', { roundId })
        .andWhere('bet.status = :status', { status: BetStatus.Active })
        .select([
          'bet.id AS betId',
          'bet.amount AS betamount',
          'bet.currency AS betcurrency',
          'bet.status AS betstatus',
          'bettingVariable.id AS variableId',
          'bettingVariable.name AS variablename',
          'bettingVariable.totalBetsTokenAmount AS variableTotalTokens',
          'bettingVariable.totalBetsCoinAmount AS variableTotalCoins',
          'bettingVariable.betCountFreeToken AS betCountFreeToken',
          'bettingVariable.betCountCoin AS betCountCoin',
        ])
        .getRawOne();
      if (!bets || bets.betstatus !== BetStatus.Active) {
        return null;
      }

      const { potentialCoinAmt, potentialFreeTokenAmt, betAmount } =
        this.potentialAmountCal(bettingRound, bets);
      return {
        betId: bets.betid,
        status: bettingRound.status,
        optionName: bets.variablename,
        potentialCoinAmt,
        potentialFreeTokenAmt,
        betAmount,
        currencyType: bets.betcurrency,
      };
    } catch (e) {
      console.error(e.message);
      throw new NotFoundException(e.message);
    }
  }

  async findPotentialAmountsForAllUsers(roundId: string) {
    try {
      const bettingRound = await this.bettingRoundsRepository.findOne({
        where: {
          id: roundId,
        },
        relations: ['bettingVariables'],
      });

      if (!bettingRound) {
        throw new NotFoundException(`Round with ID ${roundId} not found`);
      }

      // Get all active bets for this round
      const allBets = await this.betsRepository
        .createQueryBuilder('bet')
        .leftJoin('bet.bettingVariable', 'bettingVariable')
        .leftJoin('bettingVariable.round', 'round')
        .leftJoin('bet.user', 'user')
        .where('round.id = :roundId', { roundId })
        .andWhere('bet.status = :status', { status: BetStatus.Active })
        .select([
          'bet.id AS betId',
          'bet.amount AS betamount',
          'bet.currency AS betcurrency',
          'bet.status AS betstatus',
          'bet.userId AS userId',
          'user.username AS username',
          'bettingVariable.id AS variableId',
          'bettingVariable.name AS variablename',
          'bettingVariable.totalBetsTokenAmount AS variableTotalTokens',
          'bettingVariable.totalBetsCoinAmount AS variableTotalCoins',
          'bettingVariable.betCountFreeToken AS betCountFreeToken',
          'bettingVariable.betCountCoin AS betCountCoin',
        ])
        .getRawMany();

      const potentialAmounts = [];

      for (const bet of allBets) {
        if (bet.betstatus === BetStatus.Active) {
          try {
            const { potentialCoinAmt, potentialFreeTokenAmt, betAmount } =
              this.potentialAmountCal(bettingRound, bet);

            potentialAmounts.push({
              userId: bet.userid,
              username: bet.username,
              betId: bet.betid,
              status: bettingRound.status,
              optionName: bet.variablename,
              potentialCoinAmt,
              potentialFreeTokenAmt,
              betAmount,
              currencyType: bet.betcurrency,
              bettingVariableId: bet.variableid,
            });
          } catch (e) {
            console.error(
              `Error calculating potential amount for user ${bet.userid}:`,
              e.message,
            );
            // Continue with other users even if one fails
          }
        }
      }

      return potentialAmounts;
    } catch (e) {
      console.error(
        'Error finding potential amounts for all users:',
        e.message,
      );
      throw new NotFoundException(e.message);
    }
  }
  /**
   * Calculates the potential winning amount for a user’s bet in a betting round.
   *
   * This method estimates the potential reward based on the total pool size,
   * user's selected betting option, bet currency (FREE_TOKENS or STREAM_COINS),
   * and bet amount. For STREAM_COINS, a platform fee of 15% is applied before payout.
   *
   * @param {any} bettingRound - The current betting round object which includes all betting variables.
   * @param {any} bets - The user's bet object containing details such as amount, currency, and selected variable.
   *
   *
   */

  private potentialAmountCal(bettingRound, bets: any) {
    try {
      let freeTokenBetAmtForLoginUser = 0;
      let stremCoinBetAmtForLoginUser = 0;
      //bet amount of login user
      const betAmount = Number(bets?.betamount || 0);

      if (bets.betcurrency === CurrencyType.FREE_TOKENS) {
        freeTokenBetAmtForLoginUser = betAmount || 0;
      }
      if (bets.betcurrency === CurrencyType.STREAM_COINS) {
        stremCoinBetAmtForLoginUser = betAmount || 0;
      }

      const bettingVariables = bettingRound?.bettingVariables || [];
      // Find the user's option in the latest bettingVariables
      const userOption = bettingVariables.find(
        (v) => v.id === bets.variableid || v.id === bets.variableId,
      );

      const userOptionTotalTokenAmount = Number(
        userOption?.totalBetsTokenAmount || 0,
      );
      const userOptionTotalStreamCoinAmt = Number(
        userOption?.totalBetsCoinAmount || 0,
      );

      const userOptionTokenCount = Number(userOption?.betCountFreeToken || 0);
      const userOptionCoinCount = Number(userOption?.betCountCoin || 0);
      // Calculate sum of all bets on other options
      const totalFreeTokenAmount = bettingVariables.reduce(
        (sum, v) => sum + Number(v.totalBetsTokenAmount || 0),
        0,
      );
      const totalPotStreamCoinAmount = bettingVariables.reduce(
        (sum, v) => sum + Number(v.totalBetsCoinAmount || 0),
        0,
      );

      // --- MAIN LOGIC: always calculate from scratch ---
      let potentialFreeTokenAmt = freeTokenBetAmtForLoginUser;
      if (
        bets.betcurrency === CurrencyType.FREE_TOKENS &&
        userOptionTokenCount > 0
      ) {
        potentialFreeTokenAmt =
          (freeTokenBetAmtForLoginUser / userOptionTotalTokenAmount) *
          totalFreeTokenAmount;
      }
      let potentialCoinAmt = stremCoinBetAmtForLoginUser;
      if (
        bets.betcurrency === CurrencyType.STREAM_COINS &&
        userOptionCoinCount > 0
      ) {
        // Apply platform fee (15%)
        const potAmountAfterPlatformFee = totalPotStreamCoinAmount * 0.85;
        potentialCoinAmt =
          (stremCoinBetAmtForLoginUser / userOptionTotalStreamCoinAmt) *
          potAmountAfterPlatformFee;
      }
      // --- END MAIN LOGIC ---

      return {
        potentialCoinAmt,
        potentialFreeTokenAmt: Math.floor(potentialFreeTokenAmt),
        betAmount,
      };
    } catch (e) {
      console.error(e);
      throw new NotFoundException(e.message);
    }
  }

  async updateRoundStatus(
    roundId: string,
    newStatus: 'created' | 'open' | 'locked',
  ): Promise<BettingRound> {
    const round = await this.bettingRoundsRepository.findOne({
      where: { id: roundId },
    });
    if (!round) {
      throw new NotFoundException(`Round with ID ${roundId} not found`);
    }

    // Only allow: created -> open -> locked
    const current = round.status;
    let savedRound;
    if (
      (current === 'created' && newStatus === 'open') ||
      (current === 'open' && newStatus === 'locked')
    ) {
      if (newStatus === BettingRoundStatus.LOCKED) {
        const roundWithStream = await this.bettingRoundsRepository.findOne({
          where: { id: roundId },
          relations: ['stream'],
        });
        if (roundWithStream && roundWithStream.streamId) {
          const similarBets = await this.betsRepository.find({
            where: {
              round: { id: roundId },
              status: BetStatus.Active,
            },
            relations: ['round'],
          });
          // This is to prevent locking a round with no competition
          if (similarBets.length <= 1) {
            let message =
              similarBets.length === 1
                ? `Cannot lock the bet — only one user has placed a bet`
                : `Cannot lock the bet — no user has placed a bet`;
            throw new NotFoundException(message);
          }

          round.status = newStatus as any;
          savedRound = await this.bettingRoundsRepository.save(round);
          this.bettingGateway.emitBettingStatus(
            roundWithStream.streamId,
            roundId,
            'locked',
            true,
          );

          const bets = await this.betsRepository.find({
            where: { round: { id: roundId }, status: BetStatus.Active },
            relations: ['user'],
          });

          for (const bet of bets) {
            await this.bettingGateway.emitLockBetRound(
              roundWithStream.roundName,
              bet.userId,
              bet.user.username,
            );
          }
        }
      }

      if (newStatus === BettingRoundStatus.OPEN) {
        round.status = newStatus as any;
        savedRound = await this.bettingRoundsRepository.save(round);
        const roundWithStream = await this.bettingRoundsRepository.findOne({
          where: { id: roundId },
          relations: ['stream'],
        });
        if (roundWithStream && roundWithStream.streamId) {
          this.bettingGateway.emitBettingStatus(
            roundWithStream.streamId,
            roundId,
            'open',
          );
          this.bettingGateway.emitOpenBetRound(
            round.roundName,
            roundWithStream.stream.name,
          );
        }
      }
      return savedRound;
    } else {
      throw new BadRequestException(
        `Invalid status transition from ${current} to ${newStatus}. Allowed: created -> open -> locked.`,
      );
    }
  }

  async cancelRoundAndRefund(
    roundId: string,
  ): Promise<{ refundedBets: Bet[] }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // Fetch the round with variables and bets
      const round = await this.bettingRoundsRepository.findOne({
        where: { id: roundId },
        relations: ['bettingVariables', 'bettingVariables.bets'],
      });
      if (!round) {
        throw new NotFoundException('Betting round not found');
      }
      // Set round status to CANCELLED
      round.status = BettingRoundStatus.CANCELLED;
      await queryRunner.manager.save(round);
      const refundedBets: Bet[] = [];
      // Refund all bets in all variables
      for (const variable of round.bettingVariables) {
        // Set variable status to CANCELLED
        variable.status = BettingVariableStatus.CANCELLED;
        for (const bet of variable.bets) {
          const { username } = await this.usersService.findById(bet.userId);
          if (bet.status !== BetStatus.Active) continue;
          // Refund to user
          if (bet.currency === CurrencyType.FREE_TOKENS) {
            await this.walletsService.addFreeTokens(
              bet.userId,
              bet.amount,
              `Refund for cancelled round ${round.roundName}`,
            );
            variable.totalBetsTokenAmount -= Number(bet.amount);
            variable.betCountFreeToken -= 1;
          } else if (bet.currency === CurrencyType.STREAM_COINS) {
            await this.walletsService.addStreamCoins(
              bet.userId,
              bet.amount,
              `Refund for cancelled round ${round.roundName}`,
              'refund',
            );
            variable.totalBetsCoinAmount -= Number(bet.amount);
            variable.betCountCoin -= 1;
          }
          bet.status = BetStatus.Cancelled;
          refundedBets.push(bet);
          await queryRunner.manager.save(bet);

          await this.bettingGateway.emitBotMessageForCancelBetByAdmin(
            bet.userId,
            username,
            bet.amount,
            bet.currency,
            variable.name,
            round.roundName,
          );
        }
        await queryRunner.manager.save(variable);
      }
      await queryRunner.commitTransaction();
      if (round.streamId) {
        await this.bettingGateway.emitBettingStatus(
          round.streamId,
          roundId,
          'canceled',
        );
      }

      return { refundedBets };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getRoundTotals(roundId: string) {
    const bettingVariables = await this.bettingVariablesRepository.find({
      where: { roundId },
    });

    const totalBetsTokenAmount = bettingVariables.reduce(
      (sum, v) => Number(sum) + Number(v.totalBetsTokenAmount || 0),
      0,
    );
    const totalBetsCoinAmount = bettingVariables.reduce(
      (sum, v) => Number(sum) + Number(v.totalBetsCoinAmount || 0),
      0,
    );

    return { totalBetsTokenAmount, totalBetsCoinAmount };
  }

  getActiveBetsCount(): Promise<number> {
    return this.betsRepository.count({
      where: {
        status: BetStatus.Active,
      },
    });
  }

  /**
   * Returns the total bet value for a stream, separated by free tokens and coins.
   * @param streamId - The ID of the stream
   * @returns Promise<{ freeTokens: number; coins: number }>
   */
  async getTotalBetValueForStream(
    streamId: string,
  ): Promise<{ freeTokens: number; coins: number }> {
    // Get total bet value for free tokens (exclude cancelled, pending, refunded)
    const tokenResult = await this.betsRepository
      .createQueryBuilder('bet')
      .select('SUM(bet.amount)', 'totalBetValue')
      .where('bet.streamId = :streamId', { streamId })
      .andWhere('bet.currency = :currency', {
        currency: CurrencyType.FREE_TOKENS,
      })
      .andWhere('bet.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [
          BetStatus.Cancelled,
          BetStatus.Pending,
          BetStatus.Refunded,
        ],
      })
      .getRawOne();

    // Get total bet value for coins (exclude cancelled, pending, refunded)
    const coinResult = await this.betsRepository
      .createQueryBuilder('bet')
      .select('SUM(bet.amount)', 'totalBetValue')
      .where('bet.streamId = :streamId', { streamId })
      .andWhere('bet.currency = :currency', {
        currency: CurrencyType.STREAM_COINS,
      })
      .andWhere('bet.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [
          BetStatus.Cancelled,
          BetStatus.Pending,
          BetStatus.Refunded,
        ],
      })
      .getRawOne();

    return {
      freeTokens: Number(tokenResult?.totalBetValue) || 0,
      coins: Number(coinResult?.totalBetValue) || 0,
    };
  }

  /**
   * Returns the total number of unique users who have placed bets on a given stream,
   * excluding bets with status Cancelled, Refunded, or Pending.
   *
   * @param streamId - The ID of the stream
   * @returns Promise<number> - The count of unique users who placed valid bets
   */
  async getTotalBetPlacedUsersForStream(streamId: string): Promise<number> {
    // Query for unique user count, excluding unwanted bet statuses
    const result = await this.betsRepository
      .createQueryBuilder('bet')
      .select('COUNT(DISTINCT bet.userId)', 'count')
      .where('bet.streamId = :streamId', { streamId })
      .andWhere('bet.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [
          BetStatus.Cancelled,
          BetStatus.Refunded,
          BetStatus.Pending,
        ],
      })
      .getRawOne();

    // Return the count as a number (default to 0 if null)
    return Number(result.count);
  }

  /**
   * Fetches betting statistics for a given stream when the round status is OPEN and bet status is ACTIVE.
   *
   * The result includes:
   * - total token bets and amount (currency = freeToken)
   * - total coin bets and amount (currency = coin)
   *
   * @param streamId - The ID of the stream to filter bets by.
   * @returns An object containing:
   *  {
   *    totalTokenAmount: number,
   *    totalTokenBet: number,
   *    totalCoinAmount: number,
   *    totalCoinBet: number
   *  }
   *
   * @throws Will throw an error if the database query fails.
   */
  async getBetStatsByStream(streamId: string) {
    try {
      const betStat = await this.betsRepository
        .createQueryBuilder('bet')
        .innerJoin('bet.round', 'round')
        .where('bet.streamId = :streamId', { streamId })
        .andWhere('bet.status = :betStatus', { betStatus: BetStatus.Active })
        .andWhere('round.status = :roundStatus', {
          roundStatus: BettingRoundStatus.OPEN,
        })
        .select([
          // Token bets count and amount
          `COALESCE(SUM(CASE WHEN bet.currency = :freeToken THEN bet.amount ELSE 0 END), 0) AS totalTokenAmount`,
          `COALESCE(COUNT(CASE WHEN bet.currency = :freeToken THEN 1 END), 0) AS totalTokenBet`,

          // Coin bets count and amount
          `COALESCE(SUM(CASE WHEN bet.currency = :coin THEN bet.amount ELSE 0 END), 0) AS totalCoinAmount`,
          `COALESCE(COUNT(CASE WHEN bet.currency = :coin THEN 1 END), 0) AS totalCoinBet`,
        ])
        .setParameters({
          freeToken: CurrencyType.FREE_TOKENS,
          coin: CurrencyType.STREAM_COINS,
        })
        .getRawOne();
      // Ensure numeric output
      return betStat;
    } catch (error) {
      Logger.error(
        `Failed to fetch bet stats for streamId: ${streamId}`,
        error.stack,
      );
      throw new Error(
        'Could not retrieve bet statistics. Please try again later.',
      );
    }
  }
}
