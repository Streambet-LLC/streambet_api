import {
  Injectable,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
  HttpStatus,
  Logger,
  InternalServerErrorException,
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
          totalBetsGoldCoinAmount: variable.totalBetsGoldCoinAmount,
          totalBetsSweepCoinAmount: variable.totalBetsSweepCoinAmount,
          betCountGoldCoin: variable.betCountGoldCoin,
          betCountSweepCoin: variable.betCountSweepCoin,
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
  /**
   * Returns all rounds for a stream, with their options and winners (if any), separated by currency type.
   * @param streamId string
   */
  async getStreamRoundsWithWinners(streamId: string) {
    // Get all rounds for the stream, with their betting variables and bets
    const rounds = await this.bettingRoundsRepository.find({
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
          totalBetsSweepCoinAmount: variable.totalBetsSweepCoinAmount,
          totalBetsGoldCoinAmount: variable.totalBetsGoldCoinAmount,
          betCountSweepCoin: variable.betCountSweepCoin,
          betCountGoldCoin: variable.betCountGoldCoin,
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
      if (currencyType === CurrencyType.GOLD_COINS) {
        bettingVariable.totalBetsGoldCoinAmount =
          Number(bettingVariable.totalBetsGoldCoinAmount) + Number(amount);
        bettingVariable.betCountGoldCoin += 1;
      } else if (currencyType === CurrencyType.SWEEP_COINS) {
        bettingVariable.totalBetsSweepCoinAmount =
          Number(bettingVariable.totalBetsSweepCoinAmount) + Number(amount);
        bettingVariable.betCountSweepCoin += 1;
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
        if (betDetails.currency === CurrencyType.GOLD_COINS) {
          await this.walletsService.addGoldCoins(
            userId,
            refundAmount,
            `Refund from bet edit: ${refundAmount}`,
          );
        } else {
          await this.walletsService.addSweepCoins(
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
      if (betDetails.currency === CurrencyType.GOLD_COINS) {
        if (isSameOption) {
          bettingVariable.totalBetsGoldCoinAmount =
            Number(bettingVariable.totalBetsGoldCoinAmount) -
            Number(betDetails.amount) +
            Number(newAmount);
        } else {
          oldBettingVariable.totalBetsGoldCoinAmount =
            Number(oldBettingVariable.totalBetsGoldCoinAmount) -
            Number(betDetails.amount);
          bettingVariable.totalBetsGoldCoinAmount =
            Number(bettingVariable.totalBetsGoldCoinAmount) + Number(newAmount);
        }
        if (!isSameOption) {
          oldBettingVariable.betCountGoldCoin -= 1;
          bettingVariable.betCountGoldCoin += 1;
        }
      } else {
        if (isSameOption) {
          bettingVariable.totalBetsSweepCoinAmount =
            Number(bettingVariable.totalBetsSweepCoinAmount) -
            Number(betDetails.amount) +
            Number(newAmount);
        } else {
          oldBettingVariable.totalBetsSweepCoinAmount =
            Number(oldBettingVariable.totalBetsSweepCoinAmount) -
            Number(betDetails.amount);
          bettingVariable.totalBetsSweepCoinAmount =
            Number(bettingVariable.totalBetsSweepCoinAmount) +
            Number(newAmount);
        }
        if (!isSameOption) {
          oldBettingVariable.betCountSweepCoin -= 1;
          bettingVariable.betCountSweepCoin += 1;
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

      if (currencyType === CurrencyType.GOLD_COINS) {
        await this.walletsService.addGoldCoins(
          userId,
          bet.amount,
          refundMessage,
        );
        bettingVariable.totalBetsGoldCoinAmount =
          Number(bettingVariable.totalBetsGoldCoinAmount) - amount;
        bettingVariable.betCountGoldCoin -= 1;
      } else {
        await this.walletsService.addSweepCoins(
          userId,
          bet.amount,
          refundMessage,
          'refund',
        );
        bettingVariable.totalBetsSweepCoinAmount =
          Number(bettingVariable.totalBetsSweepCoinAmount) - amount;
        bettingVariable.betCountSweepCoin -= 1;
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
          [], // No losers
        );
        this.bettingGateway.emitStreamListEvent(StreamList.StreamBetUpdated);
        return;
      }

      const {
        winningBets,
        losingBets,
        winningGoldCoinBets,
        winningSweepCoinBets,
        losingGoldCoinBets,
        losingSweepCoinBets,
      } = this.splitBets(allStreamBets, variableId);
      const {
        totalWinningGoldCoinAmount,
        totalLosingGoldCoinAmount,
        totalWinningSweepCoinAmount,
        totalLosingSweepCoinAmount,
        sweepCoinPlatformFee,
        distributableSweepCoinPot,
      } = this.calculatePots(
        winningGoldCoinBets,
        losingGoldCoinBets,
        winningSweepCoinBets,
        losingSweepCoinBets,
      );

      // Process winning Gold Coin bets only if there are any
      if (winningGoldCoinBets.length > 0 && totalWinningGoldCoinAmount > 0) {
        await this.processWinningGoldCoinBets(
          queryRunner,
          winningGoldCoinBets,
          totalWinningGoldCoinAmount,
          totalLosingGoldCoinAmount,
          bettingVariable,
        );
      }

      // Process winning sweep coin bets only if there are any
      if (winningSweepCoinBets.length > 0 && totalWinningSweepCoinAmount > 0) {
        await this.processWinningSweepCoinBets(
          queryRunner,
          winningSweepCoinBets,
          totalWinningSweepCoinAmount,
          distributableSweepCoinPot,
          bettingVariable,
          totalLosingSweepCoinAmount,
        );
      }

      // Process losing bets
      if (losingBets.length > 0) {
        await this.processLosingBets(queryRunner, losingBets);
        if (winningGoldCoinBets.length === 0) {
          await this.creditAmountVoidCase(queryRunner, losingGoldCoinBets);
        }
        if (winningSweepCoinBets.length === 0) {
          await this.creditAmountVoidCase(queryRunner, losingSweepCoinBets);
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
      const lossingBetsWithUserInfo = await queryRunner.manager.find(Bet, {
        where: {
          roundId: bettingVariable.roundId,
          status: BetStatus.Lost,
        },
        relations: ['user', 'bettingVariable', 'round'],
      });
      const losers = lossingBetsWithUserInfo.map((bet) => ({
        userId: bet.userId,
        username: bet.user?.username,
      }));
      await queryRunner.commitTransaction();

      this.bettingGateway.emitWinnerDeclared(
        bettingVariable.stream.id,
        bettingVariable.id,
        bettingVariable.name,
        winners,
        losers,
      );

      this.bettingGateway.emitStreamListEvent(StreamList.StreamBetUpdated);

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
        if (winner.currencyType === CurrencyType.GoldCoin) {
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

      lossingBetsWithUserInfo.map(async (bet) => {
        if (winningSweepCoinBets.length > 0 || winningGoldCoinBets.length > 0) {
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
        winningGoldCoinBets: [],
        winningSweepCoinBets: [],
        losingGoldCoinBets: [],
        losingSweepCoinBets: [],
      };
    }

    if (!variableId) {
      console.log('Invalid variableId input:', variableId);
      return {
        winningBets: [],
        losingBets: [],
        winningGoldCoinBets: [],
        winningSweepCoinBets: [],
        losingGoldCoinBets: [],
        losingSweepCoinBets: [],
      };
    }

    const winningBets = allStreamBets.filter(
      (bet) => bet && bet.bettingVariableId === variableId,
    );
    const losingBets = allStreamBets.filter(
      (bet) => bet && bet.bettingVariableId !== variableId,
    );
    const winningGoldCoinBets = winningBets.filter(
      (bet) => bet && bet.currency === CurrencyType.GOLD_COINS,
    );
    const winningSweepCoinBets = winningBets.filter(
      (bet) => bet && bet.currency === CurrencyType.SWEEP_COINS,
    );
    const losingGoldCoinBets = losingBets.filter(
      (bet) => bet && bet.currency === CurrencyType.GOLD_COINS,
    );
    const losingSweepCoinBets = losingBets.filter(
      (bet) => bet && bet.currency === CurrencyType.SWEEP_COINS,
    );

    return {
      winningBets,
      losingBets,
      winningGoldCoinBets,
      winningSweepCoinBets,
      losingGoldCoinBets,
      losingSweepCoinBets,
    };
  }

  private calculatePots(
    winningGoldCoinBets,
    losingGoldCoinBets,
    winningSweepCoinBets,
    losingSweepCoinBets,
  ) {
    // Validate inputs and provide defaults
    const safeWinningGoldCoinBets = Array.isArray(winningGoldCoinBets)
      ? winningGoldCoinBets
      : [];
    const safeLosingGoldCoinBets = Array.isArray(losingGoldCoinBets)
      ? losingGoldCoinBets
      : [];
    const safeWinningSweepCoinBets = Array.isArray(winningSweepCoinBets)
      ? winningSweepCoinBets
      : [];
    const safeLosingSweepCoinBets = Array.isArray(losingSweepCoinBets)
      ? losingSweepCoinBets
      : [];

    const totalWinningGoldCoinAmount = safeWinningGoldCoinBets.reduce(
      (sum, bet) => Number(sum) + Number(bet?.amount || 0),
      0,
    );
    const totalLosingGoldCoinAmount = safeLosingGoldCoinBets.reduce(
      (sum, bet) => Number(sum) + Number(bet?.amount || 0),
      0,
    );
    const totalWinningSweepCoinAmount = safeWinningSweepCoinBets.reduce(
      (sum, bet) => Number(sum) + Number(bet?.amount || 0),
      0,
    );
    const totalLosingSweepCoinAmount = safeLosingSweepCoinBets.reduce(
      (sum, bet) => Number(sum) + Number(bet?.amount || 0),
      0,
    );
    const sweepCoinPlatformFee = Math.floor(totalLosingSweepCoinAmount * 0.15);
    const distributableSweepCoinPot =
      totalLosingSweepCoinAmount - sweepCoinPlatformFee;

    return {
      totalWinningGoldCoinAmount,
      totalLosingGoldCoinAmount,
      totalWinningSweepCoinAmount,
      totalLosingSweepCoinAmount,
      sweepCoinPlatformFee,
      distributableSweepCoinPot,
    };
  }

  private async processWinningGoldCoinBets(
    queryRunner,
    winningGoldCoinBets,
    totalWinningGoldCoinAmount,
    totalLosingGoldCoinAmount,
    bettingVariable,
  ) {
    // Validate inputs to prevent division by zero
    if (
      !winningGoldCoinBets ||
      winningGoldCoinBets.length === 0 ||
      totalWinningGoldCoinAmount <= 0
    ) {
      console.log(
        'No winning Gold Coin bets to process or invalid total amount',
      );
      return;
    }

    for (const bet of winningGoldCoinBets) {
      try {
        const totalBetForWinningOption =
          bet.bettingVariable?.totalBetsGoldCoinAmount;
        //bet amount placed by user
        const betAmount = bet.amount;

        // payout calculation, Multiply by the total Gold Coin pool (winning + losing side)

        const payout = Math.floor(
          (betAmount / totalBetForWinningOption) *
            Number(totalWinningGoldCoinAmount + totalLosingGoldCoinAmount),
        );

        bet.status = BetStatus.Won;
        bet.payoutAmount = payout;
        bet.processedAt = new Date();
        bet.isProcessed = true;
        await queryRunner.manager.save(bet);
        await this.walletsService.creditWinnings(
          bet.userId,
          payout,
          CurrencyType.GOLD_COINS,
          `Winnings from bet on ${bettingVariable.name}`,
        );
      } catch (error) {
        console.error(
          `Error processing winning Gold Coin bet ${bet.id}:`,
          error,
        );
        throw error;
      }
    }
  }

  private async processWinningSweepCoinBets(
    queryRunner,
    winningSweepCoinBets,
    totalWinningSweepCoinAmount,
    distributableSweepCoinPot,
    bettingVariable,
    totalLosingSweepCoinAmount,
  ) {
    // Validate inputs to prevent division by zero
    if (
      !winningSweepCoinBets ||
      winningSweepCoinBets.length === 0 ||
      totalWinningSweepCoinAmount <= 0
    ) {
      console.log(
        'No winning Sweep coin bets to process or invalid total amount',
      );
      return;
    }

    for (const bet of winningSweepCoinBets) {
      try {
        const totalBetForWinningOption =
          bet.bettingVariable?.totalBetsSweepCoinAmount;
        //bet amount placed by user
        const betAmount = bet.amount;
        //reduce 15% - platform fee from total Sweep coin pot amount
        const potAmountAfterPlatformFee =
          Number(totalWinningSweepCoinAmount + totalLosingSweepCoinAmount) *
          0.85;
        //calculation
        let payout =
          (betAmount / totalBetForWinningOption) * potAmountAfterPlatformFee;
        // reduce Sweep coin, upto 3 decimal place
        payout = Number(payout.toFixed(3));

        bet.status = BetStatus.Won;
        bet.payoutAmount = payout;
        bet.processedAt = new Date();
        bet.isProcessed = true;
        await queryRunner.manager.save(bet);
        await this.walletsService.creditWinnings(
          bet.userId,
          payout,
          CurrencyType.SWEEP_COINS,
          `Winnings from bet on ${bettingVariable.name}`,
        );
      } catch (error) {
        console.error(
          `Error processing winning sweep coin bet ${bet.id}:`,
          error,
        );
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
          'bettingVariable.total_bets_gold_coin_amount AS variableTotalGoldCoins',
          'bettingVariable.total_bets_sweep_coin_amount AS variableTotalSweepCoins',
          'bettingVariable.bet_count_gold_coin AS betCountFreeGoldCoin',
          'bettingVariable.bet_count_sweep_coin AS betCountSweepCoin',
        ])
        .getRawOne();
      if (!bets || bets.betstatus !== BetStatus.Active) {
        return null;
      }

      const { potentialSweepCoinAmt, potentialGoldCoinAmt, betAmount } =
        this.potentialAmountCal(bettingRound, bets);
      return {
        betId: bets.betid,
        status: bettingRound.status,
        optionName: bets.variablename,
        potentialSweepCoinAmt,
        potentialGoldCoinAmt,
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
          'bettingVariable.totalBetsGoldCoinAmount AS variableTotalGoldCoins',
          'bettingVariable.totalBetsSweepCoinAmount AS variableTotalSweepCoins',
          'bettingVariable.betCountFreeGoldCoin AS betCountFreeGoldCoin',
          'bettingVariable.betCountSweepCoin AS betCountSweepCoin',
        ])
        .getRawMany();

      const potentialAmounts = [];

      for (const bet of allBets) {
        if (bet.betstatus === BetStatus.Active) {
          try {
            const { potentialSweepCoinAmt, potentialGoldCoinAmt, betAmount } =
              this.potentialAmountCal(bettingRound, bet);

            potentialAmounts.push({
              userId: bet.userid,
              username: bet.username,
              betId: bet.betid,
              status: bettingRound.status,
              optionName: bet.variablename,
              potentialSweepCoinAmt,
              potentialGoldCoinAmt,
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
   * user's selected betting option, bet currency (GOLD_COIN  or SWEEP_COINS),
   * and bet amount. For SWEEP_COINS, a platform fee of 15% is applied before payout.
   *
   * @param {any} bettingRound - The current betting round object which includes all betting variables.
   * @param {any} bets - The user's bet object containing details such as amount, currency, and selected variable.
   *
   *
   */

  private potentialAmountCal(bettingRound, bets: any) {
    try {
      let goldCoinBetAmtForLoginUser = 0;
      let sweepCoinBetAmtForLoginUser = 0;
      //bet amount of login user
      const betAmount = Number(bets?.betamount || 0);

      if (bets.betcurrency === CurrencyType.GOLD_COINS) {
        goldCoinBetAmtForLoginUser = betAmount || 0;
      }
      if (bets.betcurrency === CurrencyType.SWEEP_COINS) {
        sweepCoinBetAmtForLoginUser = betAmount || 0;
      }

      const bettingVariables = bettingRound?.bettingVariables || [];
      // Find the user's option in the latest bettingVariables
      const userOption = bettingVariables.find(
        (v) => v.id === bets.variableid || v.id === bets.variableId,
      );

      const userOptionTotalGoldCoinAmount = Number(
        userOption?.totalBetsGoldCoinAmount || 0,
      );
      const userOptionTotalSweepCoinAmt = Number(
        userOption?.totalBetsSweepCoinAmount || 0,
      );

      const userOptionGoldCoinCount = Number(userOption?.betCountGoldCoin || 0);
      const userOptionSweepCoinCount = Number(
        userOption?.betCountSweepCoin || 0,
      );
      // Calculate sum of all bets on other options
      const totalGoldCoinAmount = bettingVariables.reduce(
        (sum, v) => sum + Number(v.totalBetsGoldCoinAmount || 0),
        0,
      );
      const totalPotSweepCoinAmount = bettingVariables.reduce(
        (sum, v) => sum + Number(v.totalBetsSweepCoinAmount || 0),
        0,
      );

      // --- MAIN LOGIC: always calculate from scratch ---
      let potentialGoldCoinAmt = goldCoinBetAmtForLoginUser;
      if (
        bets.betcurrency === CurrencyType.GOLD_COINS &&
        userOptionGoldCoinCount > 0
      ) {
        potentialGoldCoinAmt =
          (goldCoinBetAmtForLoginUser / userOptionTotalGoldCoinAmount) *
          totalGoldCoinAmount;
      }
      let potentialSweepCoinAmt = sweepCoinBetAmtForLoginUser;
      if (
        bets.betcurrency === CurrencyType.SWEEP_COINS &&
        userOptionSweepCoinCount > 0
      ) {
        // Apply platform fee (15%)
        const potAmountAfterPlatformFee = totalPotSweepCoinAmount * 0.85;
        potentialSweepCoinAmt =
          (sweepCoinBetAmtForLoginUser / userOptionTotalSweepCoinAmt) *
          potAmountAfterPlatformFee;
      }
      // --- END MAIN LOGIC ---

      return {
        potentialSweepCoinAmt,
        potentialGoldCoinAmt: Math.floor(potentialGoldCoinAmt),
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

      this.bettingGateway.emitStreamListEvent(StreamList.StreamBetUpdated)
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
          if (bet.currency === CurrencyType.GOLD_COINS) {
            await this.walletsService.addGoldCoins(
              bet.userId,
              bet.amount,
              `Refund for cancelled round ${round.roundName}`,
            );
            variable.totalBetsGoldCoinAmount -= Number(bet.amount);
            variable.betCountGoldCoin -= 1;
          } else if (bet.currency === CurrencyType.SWEEP_COINS) {
            await this.walletsService.addSweepCoins(
              bet.userId,
              bet.amount,
              `Refund for cancelled round ${round.roundName}`,
              'refund',
            );
            variable.totalBetsSweepCoinAmount -= Number(bet.amount);
            variable.betCountSweepCoin -= 1;
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

      this.bettingGateway.emitStreamListEvent(StreamList.StreamBetUpdated)

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

    const totalBetsGoldCoinAmount = bettingVariables.reduce(
      (sum, v) => Number(sum) + Number(v.totalBetsGoldCoinAmount || 0),
      0,
    );
    const totalBetsSweepCoinAmount = bettingVariables.reduce(
      (sum, v) => Number(sum) + Number(v.totalBetsSweepCoinAmount || 0),
      0,
    );
const totalGoldCoinBet = bettingVariables.reduce(
  (sum, v) => Number(sum) + Number(v.betCountGoldCoin || 0),
  0,
);
const totalSweepCoinBet = bettingVariables.reduce(
  (sum, v) => Number(sum) + Number(v.betCountSweepCoin || 0),
  0,
);
return {
  totalBetsGoldCoinAmount,
  totalBetsSweepCoinAmount,
  totalSweepCoinBet,
  totalGoldCoinBet,
};
  }

  getActiveBetsCount(): Promise<number> {
    return this.betsRepository.count({
      where: {
        status: BetStatus.Active,
      },
    });
  }

  /**
   * Returns the total bet value for a stream, separated by Gold Coins and Sweep coins.
   * @param streamId - The ID of the stream
   * @returns Promise<{ goldCoins: number; Sweep coins: number }>
   */
  async getTotalBetValueForStream(
    streamId: string,
  ): Promise<{ goldCoins: number; sweepCoins: number }> {
    // Get total bet value for Gold Coins (exclude cancelled, pending, refunded)
    const goldCoinResult = await this.betsRepository
      .createQueryBuilder('bet')
      .select('SUM(bet.amount)', 'totalBetValue')
      .where('bet.streamId = :streamId', { streamId })
      .andWhere('bet.currency = :currency', {
        currency: CurrencyType.GOLD_COINS,
      })
      .andWhere('bet.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [
          BetStatus.Cancelled,
          BetStatus.Pending,
          BetStatus.Refunded,
        ],
      })
      .getRawOne();

    // Get total bet value for sweep coins (exclude cancelled, pending, refunded)
    const sweepCoinResult = await this.betsRepository
      .createQueryBuilder('bet')
      .select('SUM(bet.amount)', 'totalBetValue')
      .where('bet.streamId = :streamId', { streamId })
      .andWhere('bet.currency = :currency', {
        currency: CurrencyType.SWEEP_COINS,
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
      goldCoins: Number(goldCoinResult?.totalBetValue) || 0,
      sweepCoins: Number(sweepCoinResult?.totalBetValue) || 0,
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
   * - total Gold Coin bets and amount (currency = goldCoin)
   * - total sweep coin bets and amount (currency = sweepCoin)
   *
   * @param streamId - The ID of the stream to filter bets by.
   * @returns An object containing:
   *  {
   *    totalGoldCoinAmount: number,
   *    totalGoldCoinBet: number,
   *    totalSweepCoinAmount: number,
   *    totalSweepCoinBet: number
   *  }
   *
   * @throws Will throw an error if the database query fails.
   */
  async getBetStatsByStream(streamId: string): Promise<{
    totalGoldCoinAmount: number;
    totalGoldCoinBet: number;
    totalSweepCoinAmount: number;
    totalSweepCoinBet: number;
  }> {
    try {
      const qb = this.betsRepository
        .createQueryBuilder('bet')
        .innerJoin('bet.round', 'round')
        .where('bet.streamId = :streamId', { streamId })
        .andWhere('bet.status = :betStatus', { betStatus: BetStatus.Active })
        .andWhere('round.status = :roundStatus', {
          roundStatus: BettingRoundStatus.OPEN,
        });

      const betStat = await qb
        .select([])
        .addSelect(
          'COALESCE(SUM(CASE WHEN bet.currency = :goldCoin THEN bet.amount ELSE 0 END), 0)',
          'totalGoldCoinAmount',
        )
        .addSelect(
          'COALESCE(COUNT(CASE WHEN bet.currency = :goldCoin THEN 1 END), 0)',
          'totalGoldCoinBet',
        )
        .addSelect(
          'COALESCE(SUM(CASE WHEN bet.currency = :sweepCoin THEN bet.amount ELSE 0 END), 0)',
          'totalSweepCoinAmount',
        )
        .addSelect(
          'COALESCE(COUNT(CASE WHEN bet.currency = :sweepCoin THEN 1 END), 0)',
          'totalSweepCoinBet',
        )
        .setParameters({
          goldCoin: CurrencyType.GOLD_COINS,
          sweepCoin: CurrencyType.SWEEP_COINS,
        })
        .getRawOne();

      return {
        totalGoldCoinAmount: Number(betStat?.totalGoldCoinAmount) || 0,
        totalGoldCoinBet: Number(betStat?.totalGoldCoinBet) || 0,
        totalSweepCoinAmount: Number(betStat?.totalSweepCoinAmount) || 0,
        totalSweepCoinBet: Number(betStat?.totalSweepCoinBet) || 0,
      };
    } catch (error) {
      Logger.error(
        `Failed to fetch bet stats for streamId: ${streamId}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Could not retrieve bet statistics. Please try again later.',
      );
    }
  }
}
