import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not } from 'typeorm';
import { BettingVariable } from './entities/betting-variable.entity';
import { Bet } from './entities/bet.entity';
import { BettingVariableStatus } from '../enums/betting-variable-status.enum';
import { BetStatus } from '../enums/bet-status.enum';
import { WalletsService } from '../wallets/wallets.service';
import { v4 as uuidv4 } from 'uuid';
import { CreateStreamDto } from './dto/create-stream.dto';
import {
  CreateBettingVariableDto,
  EditBettingVariableDto,
  EditOptionDto,
} from './dto/create-betting-variable.dto';
import { EditBetDto, PlaceBetDto } from './dto/place-bet.dto';
import { CurrencyType } from '../wallets/entities/transaction.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { Stream, StreamStatus } from 'src/stream/entities/stream.entity';
import { PlatformName } from '../enums/platform-name.enum';
import { BettingRound } from './entities/betting-round.entity';
import { CancelBetDto } from './dto/cancel-bet.dto';
import { BettingRoundStatus } from 'src/enums/round-status.enum';

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
    private dataSource: DataSource,
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

    // Auto-detect platform from embeddedUrl if provided
    if (createStreamDto.embeddedUrl) {
      const detectedPlatform = this.detectPlatformFromUrl(
        createStreamDto.embeddedUrl,
      );
      if (detectedPlatform) {
        stream.platformName = detectedPlatform;
      }
    }

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
        status: BettingRoundStatus.ACTIVE,
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
          status: BettingRoundStatus.ACTIVE,
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
  async placeBet(userId: string, placeBetDto: PlaceBetDto): Promise<Bet> {
    const { bettingVariableId, amount, currencyType } = placeBetDto;

    // Find the betting variable with its round
    const bettingVariable = await this.bettingVariablesRepository.findOne({
      where: { id: bettingVariableId },
      relations: ['round', 'round.stream'],
    });
    const checkStrermIdRoundIdValid =
      await this.bettingVariablesRepository.findOne({
        where: {
          id: bettingVariableId,
          stream: { id: bettingVariable.round.streamId },
          round: { id: bettingVariable.roundId },
        },
      });
    if (!checkStrermIdRoundIdValid) {
      throw new NotFoundException(
        `This betting round is not associated with the current stream. Please check your selection`,
      );
    }
    if (!bettingVariable) {
      throw new NotFoundException(
        `Betting variable with ID ${bettingVariableId} not found`,
      );
    }

    // Check if betting is still open for the specific currency type
    if (currencyType === CurrencyType.FREE_TOKENS) {
      if (bettingVariable.round.status !== BettingRoundStatus.ACTIVE) {
        const message = await this.bettingStatusMessage(
          bettingVariable.round.status,
        );
        throw new BadRequestException(message);
      }
      if (bettingVariable.round.stream.status !== StreamStatus.LIVE) {
        throw new BadRequestException(
          `This stream is not live. You can only place bets during live streams.`,
        );
      }
    } else if (currencyType === CurrencyType.STREAM_COINS) {
      if (bettingVariable.round.status !== BettingRoundStatus.ACTIVE) {
        const message = await this.bettingStatusMessage(
          bettingVariable.round.status,
        );
        throw new BadRequestException(message);
      }
      if (bettingVariable.round.stream.status !== StreamStatus.LIVE) {
        throw new BadRequestException(
          `This stream is not live. You can only place bets during live streams.`,
        );
      }
    }

    // Check if user already has an active bet (MVP restriction)
    const existingBet = await this.betsRepository.findOne({
      where: { userId, status: BetStatus.Active },
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
        `Bet on ${bettingVariable.name} in stream ${bettingVariable.round.stream.name}`,
      );

      // Create and save the bet
      const bet = this.betsRepository.create({
        userId,
        bettingVariableId,
        amount,
        currency: currencyType,
        stream: { id: bettingVariable.streamId },
      });

      const savedBet = await queryRunner.manager.save(bet);

      // Update the betting variable's statistics based on currency type
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
  async editBet(userId: string, editBetDto: EditBetDto) {
    const { newCurrencyType, newAmount, newBettingVariableId, betId } =
      editBetDto;
    const betDetails = await this.betsRepository.findOne({
      where: { id: betId },
    });
    if (!betDetails) {
      throw new NotFoundException(`Unable to find the selected bet.`);
    }
    const cancelBetDto = {
      betId,
      currencyType: betDetails.currency,
    };
    const placeBetDto = {
      bettingVariableId: newBettingVariableId,
      amount: newAmount,
      currencyType: newCurrencyType,
    };

    // Create the bet in a transaction to ensure consistency
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const oldBet = await this.cancelBet(userId, cancelBetDto);
      const newBet = await this.placeBet(userId, placeBetDto);

      return { oldBet, newBet };
    } catch (error) {
      // Rollback in case of error
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }
  async cancelBet(userId: string, cancelBetDto: CancelBetDto): Promise<Bet> {
    const { betId, currencyType } = cancelBetDto;

    const bet = await this.betsRepository.findOne({
      where: { id: betId, userId },
      relations: ['bettingVariable', 'bettingVariable.round', 'stream'],
    });

    if (!bet) {
      throw new NotFoundException(`Bet with ID ${betId} not found`);
    }

    if (bet.status !== BetStatus.Active) {
      throw new BadRequestException('Only active bets can be canceled');
    }

    // Validate currency type and round status
    if (currencyType === CurrencyType.FREE_TOKENS) {
      if (
        bet.currency !== CurrencyType.FREE_TOKENS ||
        bet.bettingVariable.round.status !== BettingRoundStatus.ACTIVE
      ) {
        throw new BadRequestException('Betting is locked or already resolved');
      }
    } else if (currencyType === CurrencyType.STREAM_COINS) {
      if (
        bet.currency !== CurrencyType.STREAM_COINS ||
        bet.bettingVariable.round.status !== BettingRoundStatus.ACTIVE
      ) {
        throw new BadRequestException('Betting is locked or already resolved');
      }
    } else {
      throw new BadRequestException('Invalid currency type');
    }

    return await this.handleCancelBet(userId, bet, currencyType);
  }
  private async bettingStatusMessage(status: string) {
    let message: string;
    switch (status) {
      case BettingVariableStatus.CANCELLED:
        message = `This bet has already been cancelled and cannot be processed again.`;
        break;
      case BettingVariableStatus.LOCKED:
        message = `This bet has already been locked and cannot be processed again.`;
        break;
      case BettingVariableStatus.LOSER:
        message = `The result for this bet has already been announced.`;
        break;
      case BettingVariableStatus.WINNER:
        message = `The result for this bet has already been announced.`;
        break;
    }
    return message;
  }
  private async handleCancelBet(
    userId: string,
    bet: Bet,
    currencyType: CurrencyType,
  ): Promise<Bet> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const bettingVariable = bet.bettingVariable;
      const amount = Number(bet.amount);

      // Refund to wallet
      const refundMessage = `Refund for canceled bet on ${bettingVariable.name} in stream ${bet.stream.name}`;

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
          stream: { id: bettingVariable.stream.id },
          id: Not(bettingVariable.id),
          status: BettingVariableStatus.LOCKED,
        },
        { status: BettingVariableStatus.LOSER },
      );

      // Get all bets for this stream
      const allStreamBets = await queryRunner.manager.find(Bet, {
        where: {
          bettingVariable: { stream: { id: bettingVariable.stream.id } },
          status: BetStatus.Active,
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
        bet.status = BetStatus.Won;
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
        bet.status = BetStatus.Lost;
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
        .select([
          'bet.id AS betId',
          'bet.amount AS betAmount',
          'bet.currency AS betCurrency',
          'bet.status AS betStatus',
          'bettingVariable.id AS variableId',
          'bettingVariable.name AS variableName',
          'bettingVariable.totalBetsTokenAmount AS variableTotalTokens',
          'bettingVariable.totalBetsCoinAmount AS variableTotalCoins',
          'bettingVariable.betCountFreeToken AS betCountFreeToken',
          'bettingVariable.betCountCoin AS betCountCoin',
        ])
        .getRawOne();
      if (!bets) {
        throw new NotFoundException(`No matching bet found for this user`);
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
      };
    } catch (e) {
      console.error(e.message);
      throw new NotFoundException(e.message);
    }
  }
  private potentialAmountCal(bettingRound, bets) {
    try {
      const betAmount = Number(bets?.betamount || 0);

      const {
        betcountfreetoken: betCountFreeToken = 0,
        betcountcoin: betCountCoin = 0,
      } = bets;

      const bettingVariables = bettingRound?.bettingVariables || [];

      const totalCoinAmount = bettingVariables.reduce(
        (sum, variable) => sum + Number(variable.totalBetsCoinAmount || 0),
        0,
      );
      const totalTokenAmount = bettingVariables.reduce(
        (sum, variable) => sum + Number(variable.totalBetsTokenAmount || 0),
        0,
      );

      const avgFreeTokenAmt =
        betCountFreeToken > 0 ? totalTokenAmount / betCountFreeToken : 0;

      const potentialFreeTokenAmt = Math.abs(avgFreeTokenAmt - betAmount);

      const netCoinAmount = totalCoinAmount * 0.85; // After 15% platform fee

      const avgCoinAmt = betCountCoin > 0 ? netCoinAmount / betCountCoin : 0;

      const potentialCoinAmt = Math.abs(avgCoinAmt - betAmount);

      return {
        potentialCoinAmt,
        potentialFreeTokenAmt,
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
    if (
      (current === 'created' && newStatus === 'open') ||
      (current === 'open' && newStatus === 'locked')
    ) {
      round.status = newStatus as any;
      return this.bettingRoundsRepository.save(round);
    } else {
      throw new BadRequestException(
        `Invalid status transition from ${current} to ${newStatus}. Allowed: created -> open -> locked.`,
      );
    }
  }
}
