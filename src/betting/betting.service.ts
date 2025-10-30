import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  forwardRef,
  Inject,
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
import { Stream } from 'src/stream/entities/stream.entity';
import { PlatformName } from '../enums/platform-name.enum';
import { BettingRound } from './entities/betting-round.entity';
import { CancelBetDto } from './dto/cancel-bet.dto';
import { BettingRoundStatus } from 'src/enums/round-status.enum';
import { UsersService } from 'src/users/users.service';
import { StreamService } from 'src/stream/stream.service';
import { NotificationService } from 'src/notification/notification.service';
import { BettingSummaryService } from 'src/redis/betting-summary.service';
import { StreamList, StreamStatus } from 'src/enums/stream.enum';
import { StreamRoundsResponseDto } from './dto/stream-round-response.dto';
import { BetHistoryFilterDto } from './dto/bet-history.dto';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { StreamGateway } from 'src/stream/stream.gateway';
import { BettingGateway } from './betting.gateway';
import { MAX_AMOUNT_FOR_BETTING } from 'src/common/constants/currency.constants';
import { CurrencyType, CurrencyTypeText } from 'src/enums/currency.enum';
import { TransactionType } from 'src/enums/transaction-type.enum';
import _, { round } from 'lodash';
import { PlatformPayoutService } from 'src/platform-payout/plaform-payout.service';

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
    private bettingSummaryService: BettingSummaryService,
    private usersService: UsersService,
    private platformPayoutService: PlatformPayoutService,
    private dataSource: DataSource,
    private readonly bettingGateway: BettingGateway,
    @Inject(forwardRef(() => StreamService))
    private readonly streamService: StreamService,
    @Inject(forwardRef(() => StreamGateway))
    private readonly streamGateway: StreamGateway,
  ) { }

  /**
   * Detects the streaming platform from a given URL.
   *
   * This utility function checks the provided URL against a predefined set of
   * platform-specific keywords (Kick, YouTube, Twitch, Vimeo). If a match is found,
   * it returns the corresponding platform name; otherwise, it returns `null`.
   *
   * @param url - The URL string to analyze and detect the platform from.
   *
   * @returns {PlatformName | null}
   * - The detected platform as a `PlatformName` enum value if a match is found.
   * - `null` if the URL does not match any known platform.
   */
  private detectPlatformFromUrl(url: string): PlatformName | null {
    // Map each platform to its associated keywords
    const platformKeywords: Record<PlatformName, string[]> = {
      [PlatformName.Kick]: ['kick.com', 'kick'],
      [PlatformName.Youtube]: ['youtube.com', 'youtu.be', 'youtube'],
      [PlatformName.Twitch]: ['twitch.tv', 'twitch.com', 'twitch'],
      [PlatformName.Vimeo]: ['vimeo.com', 'vimeo'],
    };

    // Convert the input URL to lowercase for case-insensitive comparison
    const urlLower = url.toLowerCase();

    // Iterate through each platform and its keywords
    for (const [platform, keywords] of Object.entries(platformKeywords)) {
      // Check if the URL contains any keyword associated with the current platform
      if (keywords.some((keyword) => urlLower.includes(keyword))) {
        return platform as PlatformName; // Return the detected platform
      }
    }

    // Return null if no platform keywords match
    return null;
  }

  // Stream Management
  /**
   * Creates a new stream entry in the system.
   *
   * This function handles stream creation with the following logic:
   * - Initializes a stream entity from the provided DTO.
   * - Determines stream status based on the scheduled start time:
   *   - If the scheduled time is in the past or present → set as `LIVE`.
   *   - If the scheduled time is in the future → set as `SCHEDULED`.
   * - Automatically detects the streaming platform from the embedded URL (if provided).
   * - Saves the stream into the repository.
   * - If scheduled, registers the stream with the scheduler.
   * - Emits an event to update the stream list for connected clients.
   *
   * @param createStreamDto - DTO containing stream details (e.g., name, scheduledStartTime, embeddedUrl).
   *
   * @returns {Promise<Stream>} The newly created stream entity with updated fields.
   */
  async createStream(createStreamDto: CreateStreamDto): Promise<Stream> {
    // Create a new stream entity from the DTO
    const stream = this.streamsRepository.create(createStreamDto);

    // Handle scheduled start time: set status accordingly
    if (createStreamDto.scheduledStartTime) {
      const now = new Date();
      const scheduledTime = new Date(createStreamDto.scheduledStartTime);

      if (scheduledTime <= now) {
        stream.status = StreamStatus.LIVE; // If time is now or in the past → live
      } else {
        stream.status = StreamStatus.SCHEDULED; // Future time → scheduled
      }
    }

    // Auto-detect platform from embeddedUrl if provided
    if (createStreamDto.embeddedUrl) {
      const detectedPlatform = this.detectPlatformFromUrl(
        createStreamDto.embeddedUrl,
      );
      if (detectedPlatform) {
        stream.platformName = detectedPlatform; // Assign detected platform
      }
    }

    // Save the stream into the database
    const streamResponse = await this.streamsRepository.save(stream);

    // If stream is scheduled, register it with the scheduler
    if (stream.status === StreamStatus.SCHEDULED) {
      this.streamService.scheduleStream(
        streamResponse.id,
        stream.scheduledStartTime,
      );
    }

    // Emit event to notify connected clients that a new stream was created
    this.streamGateway.emitStreamListEvent(StreamList.StreamCreated);

    return streamResponse;
  }

  /**
   * Retrieves all streams with optional filtering of ended streams.
   *
   * This function fetches streams from the repository with the following behavior:
   * - If `includeEnded` is true → fetches all streams (live, scheduled, and ended).
   * - If `includeEnded` is false → fetches only currently `LIVE` streams.
   * - Always includes related `bettingVariables`.
   * - Streams are ordered by `createdAt` in descending order (latest first).
   *
   * @param includeEnded - Boolean flag indicating whether to include ended streams.
   *                       Defaults to `false`, meaning only live streams are returned.
   *
   * @returns {Promise<Stream[]>} A list of streams matching the criteria.
   */
  async findAllStreams(includeEnded: boolean = false): Promise<Stream[]> {
    if (includeEnded) {
      // Fetch all streams regardless of status
      return this.streamsRepository.find({
        relations: ['bettingVariables'],
        order: { createdAt: 'DESC' }, // Most recent streams first
      });
    }

    // Fetch only currently live streams
    return this.streamsRepository.find({
      where: { status: StreamStatus.LIVE },
      relations: ['bettingVariables'],
      order: { createdAt: 'DESC' }, // Most recent live streams first
    });
  }

  /**
   * Retrieves a single stream by its unique ID.
   *
   * This function looks up a stream in the repository by its ID and includes
   * related `bettingVariables`. If no stream is found, it throws a
   * `NotFoundException`.
   *
   * @param id - The unique identifier of the stream to retrieve.
   *
   * @returns {Promise<Stream>} The stream entity with its related betting variables.
   *
   * @throws {NotFoundException} If no stream exists with the given ID.
   */
  async findStreamById(id: string): Promise<Stream> {
    // Attempt to find the stream by its ID, including bettingVariables relation
    const stream = await this.streamsRepository.findOne({
      where: { id },
      relations: ['bettingVariables'],
    });

    // If no stream is found, throw a NotFoundException
    if (!stream) {
      throw new NotFoundException(`Stream with ID ${id} not found`);
    }

    // Return the found stream
    return stream;
  }

  /**
   * Updates the status of a stream by its ID.
   *
   * This function:
   * - Retrieves the stream using its ID.
   * - Updates the stream's status to the provided value.
   * - Automatically sets timestamp fields based on the new status:
   *   - If status is `LIVE` → sets `actualStartTime` to the current date/time.
   *   - If status is `ENDED` → sets `endTime` to the current date/time.
   * - Saves and returns the updated stream entity.
   *
   * @param id - The unique identifier of the stream to update.
   * @param status - The new status to apply (`LIVE`, `ENDED`, etc.).
   *
   * @returns {Promise<Stream>} The updated stream entity.
   *
   * @throws {NotFoundException} If no stream exists with the given ID.
   */
  async updateStreamStatus(id: string, status: StreamStatus): Promise<Stream> {
    // Fetch the stream by ID (throws if not found)
    const stream = await this.findStreamById(id);

    // Update the stream's status
    stream.status = status;

    // If stream is going live, set actual start time
    if (status === StreamStatus.LIVE) {
      stream.actualStartTime = new Date();
    }
    // If stream is ending, set end time
    else if (status === StreamStatus.ENDED) {
      stream.endTime = new Date();
    }

    // Save and return the updated stream entity
    return this.streamsRepository.save(stream);
  }

  // Betting Variable Management
  /**
   * Creates betting rounds and betting variables for a given stream.
   *
   * This function:
   * - Validates that betting variables cannot be added to `ENDED` streams.
   * - Iterates over the provided rounds and:
   *   - Creates a new betting round for the stream with initial status `CREATED`.
   *   - Creates betting variables (options) within each round.
   * - Collects and returns structured round data, including betting variables and their metadata.
   *
   * @param createBettingVariableDto - DTO containing:
   *   - `streamId`: The stream to which betting variables should be added.
   *   - `rounds`: An array of rounds, each containing a `roundName` and a list of betting options.
   *
   * @returns {Promise<any>} An object containing:
   *   - `streamId`: ID of the stream.
   *   - `rounds`: Array of created rounds with their associated betting variables.
   *
   * @throws {BadRequestException} If the stream has already ended.
   * @throws {NotFoundException} If the stream ID does not exist.
   */
  async createBettingVariable(
    createBettingVariableDto: CreateBettingVariableDto,
  ): Promise<any> {
    const { streamId, rounds } = createBettingVariableDto;

    // Validate stream existence
    const stream = await this.findStreamById(streamId);

    // Prevent adding betting variables to ended streams
    if (stream.status === StreamStatus.ENDED) {
      throw new BadRequestException(
        'Cannot add betting variables to ended streams',
      );
    }

    const allRounds = [];

    // Iterate through each provided round
    for (const roundData of rounds) {
      // Create and save a new betting round
      const bettingRound = this.bettingRoundsRepository.create({
        roundName: roundData.roundName,
        stream: stream,
        status: BettingRoundStatus.CREATED,
      });
      const savedRound = await this.bettingRoundsRepository.save(bettingRound);

      const createdVariables: BettingVariable[] = [];

      // Create betting variables (options) for this round
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

      // Push structured round response with betting variables
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

    // Return structured response
    return {
      streamId,
      rounds: allRounds,
    };
  }

  /**
   * Retrieves a betting variable by its unique ID.
   *
   * This function:
   * - Searches the repository for a betting variable with the given ID.
   * - Includes related entities: `stream`, `bets`, and `round`.
   * - Throws a `NotFoundException` if the betting variable does not exist.
   *
   * @param id - The unique identifier of the betting variable to retrieve.
   *
   * @returns {Promise<BettingVariable>} The betting variable entity with its relations.
   *
   * @throws {NotFoundException} If no betting variable is found with the given ID.
   */
  async findBettingVariableById(id: string): Promise<BettingVariable> {
    // Attempt to fetch the betting variable by ID, including stream, bets, and round relations
    const bettingVariable = await this.bettingVariablesRepository.findOne({
      where: { id },
      relations: ['stream', 'bets', 'round'],
    });

    // If not found, throw a NotFoundException
    if (!bettingVariable) {
      throw new NotFoundException(`Betting variable with ID ${id} not found`);
    }

    // Return the betting variable entity with its relations
    return bettingVariable;
  }

  /**
   * Updates the status of a betting variable by its ID.
   *
   * This function:
   * - Retrieves the betting variable by its ID.
   * - Updates its status to the provided value.
   * - Saves and returns the updated betting variable.
   *
   * @param id - The unique identifier of the betting variable to update.
   * @param status - The new status to assign (`ACTIVE`, `INACTIVE`, etc.).
   *
   * @returns {Promise<BettingVariable>} The updated betting variable entity.
   *
   * @throws {NotFoundException} If no betting variable exists with the given ID.
   */
  async updateBettingVariableStatus(
    id: string,
    status: BettingVariableStatus,
  ): Promise<BettingVariable> {
    // Fetch the betting variable by ID (throws NotFoundException if not found)
    const bettingVariable = await this.findBettingVariableById(id);

    // Update the status
    bettingVariable.status = status;

    // Save changes to the database
    const updatedVariable =
      await this.bettingVariablesRepository.save(bettingVariable);

    // Return the updated betting variable
    return updatedVariable;
  }

  /**
   * Retrieves all betting rounds of a given stream along with their winners.
   *
   * This function:
   * - Fetches all rounds of the stream, including betting variables and their bets (with user info).
   * - For each round:
   *   - Lists available options (betting variables).
   *   - Identifies winning and losing options.
   *   - Collects unique winning users (separately for Gold Coins and Sweep Coins).
   *   - Calculates the total winner amount, which is the sum of all bets placed
   *     on losing options (per currency).
   * - Returns structured round data including winners, amounts, and options.
   *
   * @param streamId - The unique identifier of the stream whose rounds are requested.
   *
   * @returns {Promise<StreamRoundsResponseDto>} An object containing:
   *   - `streamId`: The ID of the stream.
   *   - `rounds`: Array of round objects, each with winners, winnerAmount, and options.
   *
   * @throws {NotFoundException} If the stream does not exist (implicitly via repository call).
   */
  async getStreamRoundsWithWinners(
    streamId: string,
  ): Promise<StreamRoundsResponseDto> {
    // Get all rounds for the stream, with their betting variables and bets (including users)
    const rounds = await this.bettingRoundsRepository.find({
      where: { streamId },
      relations: [
        'bettingVariables',
        'bettingVariables.bets',
        'bettingVariables.bets.user',
      ],
      order: { createdAt: 'ASC' }, // Show rounds in chronological order
    });

    // Initialize response structure
    const result = {
      streamId,
      rounds: [] as any[],
    };

    // Process each round
    for (const round of rounds) {
      // Extract round options (betting variables), sorted by creation time
      const options = round.bettingVariables
        .map((variable) => ({
          id: variable.id,
          option: variable.name,
          createdAt: variable.createdAt,
        }))
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )
        .map(({ id, option }) => ({
          id,
          option,
        }));

      // Identify winning and losing options
      const winningOptions = round.bettingVariables.filter(
        (v) => v.is_winning_option,
      );
      const losingOptions = round.bettingVariables.filter(
        (v) => !v.is_winning_option,
      );

      // Initialize winners and payout amounts
      const winners = { goldCoins: [], sweepCoins: [] };
      const winnerAmount = { goldCoins: null, sweepCoins: null };

      if (winningOptions.length > 0) {
        // Collect winning bets for each currency
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

        // Deduplicate winners by user for Gold Coins
        const winnerUsersMapGoldCoins = new Map();
        for (const bet of winnerBetsGoldCoins) {
          if (bet.user && !winnerUsersMapGoldCoins.has(bet.user.id)) {
            winnerUsersMapGoldCoins.set(bet.user.id, {
              userId: bet.user.id,
              userName: bet.user.username,
              avatar: bet.user.profileImageUrl,
            });
          }
        }

        // Deduplicate winners by user for Sweep Coins
        const winnerUsersMapSweepCoins = new Map();
        for (const bet of winnerBetsSweepCoins) {
          if (bet.user && !winnerUsersMapSweepCoins.has(bet.user.id)) {
            winnerUsersMapSweepCoins.set(bet.user.id, {
              userId: bet.user.id,
              userName: bet.user.username,
              avatar: bet.user.profileImageUrl,
            });
          }
        }

        // Finalize winners
        winners.goldCoins = Array.from(winnerUsersMapGoldCoins.values());
        winners.sweepCoins = Array.from(winnerUsersMapSweepCoins.values());

        // Calculate payout pool: sum of bets on losing options
        const winnerAmountGoldCoins = losingOptions.reduce(
          (sum, bettingVariable) =>
            Number(sum) +
            (Number(bettingVariable.totalBetsGoldCoinAmount) || 0),
          0,
        );
        const winnerAmountSweepCoins = losingOptions.reduce(
          (sum, bettingVariable) =>
            Number(sum) +
            (Number(bettingVariable.totalBetsSweepCoinAmount) || 0),
          0,
        );

        // Assign amounts if nonzero
        winnerAmount.goldCoins =
          winnerAmountGoldCoins > 0 ? winnerAmountGoldCoins : null;
        winnerAmount.sweepCoins =
          winnerAmountSweepCoins > 0 ? winnerAmountSweepCoins : null;
      }

      // Push round summary into response
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

  /**
   * Creates, updates, or deletes betting rounds and their variables for a given stream.
   *
   * Workflow:
   *  1. Validates the stream status:
   *     - Throws an error if the stream is ENDED or CANCELLED.
   *
   *  2. Retrieves all existing rounds for the stream (with their betting variables).
   *
   *  3. Iterates over the request `rounds`:
   *     - If a `roundId` is provided and exists → update the round name.
   *     - If no `roundId` is provided → create a new round with status CREATED.
   *     - For each round, updates its betting options using `updateRoundOptions`.
   *
   *  4. Removes any rounds (and their betting variables) that exist in the database
   *     but are not included in the request payload.
   *
   *  5. Sorts all rounds in ascending order based on `createdAt`.
   *
   *  6. Emits updated round details to connected clients via `bettingGateway`.
   *
   * @param editBettingVariableDto - DTO containing:
   *   - streamId: The unique identifier of the stream.
   *   - rounds: An array of rounds, each containing:
   *       - roundId (optional, for updating existing rounds)
   *       - roundName
   *       - options (betting options for that round)
   *
   * @returns An object containing:
   *   - streamId: The stream ID for which rounds were modified.
   *   - rounds: The updated list of all rounds (created, updated, or kept).
   *
   * @throws BadRequestException - If betting variables are modified for ENDED or CANCELLED streams.
   * @throws HttpException (500) - If an unexpected error occurs during persistence or event emission.
   */
  async editBettingVariable(
    editBettingVariableDto: EditBettingVariableDto,
  ): Promise<any> {
    const { streamId, rounds } = editBettingVariableDto;
    const stream = await this.findStreamById(streamId);

    // Prevent editing if stream is ended or cancelled
    if ([StreamStatus.ENDED, StreamStatus.CANCELLED].includes(stream.status)) {
      throw new BadRequestException(
        `Cannot edit betting variables for ${stream.status.toLowerCase()} streams`,
      );
    }
    // Fetch existing rounds with variables
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
    // emit event when user update, create, delete a bet round
    const streamDetails = await this.streamService.findStreamById(streamId);
    try {
      await this.streamGateway.emitRoundDetails(streamId, streamDetails);
    } catch (err) {
      Logger.warn(
        `emitRoundDetails failed for stream ${streamId}: ${err?.message ?? err}`,
      );
    }

    return {
      streamId,
      rounds: allRounds,
    };
  }

  /**
   * Updates the options (betting variables) for a given betting round.
   *
   * Functionality:
   * - Updates existing options (if `id` is provided).
   * - Adds new options (if `id` is missing).
   * - Removes options not present in the request payload.
   * - Ensures `streamId` is correctly set when adding new options.
   * - Returns the updated round details with options.
   *
   * @param bettingRound - The round to which the options belong
   * @param options - List of option DTOs (existing and new)
   * @returns Updated round details with options
   */
  private async updateRoundOptions(
    bettingRound: BettingRound,
    options: EditOptionDto[],
  ): Promise<any> {
    // Fetch all existing variables for this round
    const existingVariables = await this.bettingVariablesRepository.find({
      where: { roundId: bettingRound.id },
    });

    // Split request options into "existing" (with id) and "new" (without id)
    const existingOptions = options.filter((opt) => opt.id);
    const newOptions = options.filter((opt) => !opt.id);

    // 🔹 Update existing options
    for (const option of existingOptions) {
      const existingVariable = existingVariables.find(
        (v) => v.id === option.id,
      );
      if (existingVariable) {
        existingVariable.name = option.option;
        await this.bettingVariablesRepository.save(existingVariable);
      }
    }

    // 🔹 Ensure bettingRound has stream relation populated
    if (!bettingRound.stream) {
      const roundWithStream = await this.bettingRoundsRepository.findOne({
        where: { id: bettingRound.id },
        relations: ['stream'],
      });
      bettingRound.stream = roundWithStream?.stream;
    }

    // 🔹 Add new options (create new betting variables)
    for (const option of newOptions) {
      const bettingVariable = this.bettingVariablesRepository.create({
        name: option.option,
        round: bettingRound,
        stream: bettingRound.stream,
        streamId: bettingRound.stream?.id, // Ensure streamId is linked
      });
      await this.bettingVariablesRepository.save(bettingVariable);
    }

    // 🔹 Remove variables that are not in the new request
    const optionIdsToKeep = existingOptions.map((opt) => opt.id);
    const variablesToDelete = existingVariables.filter(
      (v) => v.id && !optionIdsToKeep.includes(v.id),
    );

    for (const variable of variablesToDelete) {
      await this.bettingVariablesRepository.remove(variable);
    }

    // 🔹 Fetch the updated list of variables for the round
    const updatedVariables = await this.bettingVariablesRepository.find({
      where: { roundId: bettingRound.id },
      order: { createdAt: 'ASC' },
    });

    // 🔹 Return updated round details with its options
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

  // Betting Operations
  /**
   * Places a bet for a user on a given betting variable.
   *
   * Workflow:
   * 1. Validate the betting variable and round/stream status.
   * 2. Ensure the user does not already have an active bet in the same round.
   * 3. Deduct the bet amount from the user's wallet inside a transaction.
   * 4. Create and save the bet.
   * 5. Update the betting variable’s aggregated bet amounts and counts using a write lock
   *    to prevent race conditions.
   * 6. Commit the transaction or roll back on failure.
   *
   * @param userId - The ID of the user placing the bet.
   * @param placeBetDto - Data Transfer Object containing bettingVariableId, amount, and currencyType.
   * @returns The saved bet along with the round ID where the bet was placed.
   * @throws NotFoundException - If the betting variable or round is not found.
   * @throws BadRequestException - If the round/stream is closed, ended, or user already has an active bet.
   */
  async placeBet(
    userId: string,
    placeBetDto: PlaceBetDto,
  ): Promise<{ bet: Bet; roundId: string }> {
    const { bettingVariableId, amount, currencyType } = placeBetDto;
    this.enforceMax(amount, currencyType);
    // Fetch betting variable along with round and stream
    const bettingVariable = await this.bettingVariablesRepository.findOne({
      where: { id: bettingVariableId },
      relations: ['round', 'round.stream'],
    });

    // Validate betting variable existence
    if (!bettingVariable) {
      throw new NotFoundException(
        `Could not find an active betting variable with the specified ID. Please check the ID and try again.`,
      );
    }

    // Ensure the round is open for betting
    if (bettingVariable?.round?.status !== BettingRoundStatus.OPEN) {
      const message = await this.bettingRoundStatusMessage(
        bettingVariable.round.status,
      );
      throw new BadRequestException(message);
    }

    // Ensure the stream is not ended
    if (bettingVariable?.round?.stream?.status === StreamStatus.ENDED) {
      throw new BadRequestException(
        `This stream is Ended. You can only place bets during live and scheduled streams.`,
      );
    }

    // Ensure the user does not already have an active bet in the same round
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

    // Start transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let roundIdToUpdate: string | null = null;

    try {
      // Deduct bet amount from wallet (transactional)
      await this.walletsService.deductForBet(
        userId,
        amount,
        currencyType,
        `Bet ${amount} on "${bettingVariable.name}" for stream "${bettingVariable.round.stream.name}" (Round ${bettingVariable.round.roundName})`,
        queryRunner.manager,
      );

      // Create new bet entity
      const bet = this.betsRepository.create({
        userId,
        bettingVariableId,
        amount,
        currency: currencyType,
        stream: { id: bettingVariable.streamId },
        roundId: bettingVariable.roundId,
      });

      // Save bet within transaction
      const savedBet = await queryRunner.manager.save(bet);

      // Re-fetch betting variable with a pessimistic write lock to prevent race conditions
      const lockedBettingVariable = await queryRunner.manager.findOne(
        BettingVariable,
        {
          where: { id: bettingVariableId },
          lock: { mode: 'pessimistic_write' }, // prevents simultaneous updates
        },
      );

      if (!lockedBettingVariable) {
        throw new NotFoundException('Betting variable not found');
      }

      // Update betting variable totals based on currency type
      if (currencyType === CurrencyType.GOLD_COINS) {
        lockedBettingVariable.totalBetsGoldCoinAmount =
          Number(lockedBettingVariable.totalBetsGoldCoinAmount) +
          Number(amount);
        lockedBettingVariable.betCountGoldCoin =
          Number(lockedBettingVariable.betCountGoldCoin) + 1;
      } else if (currencyType === CurrencyType.SWEEP_COINS) {
        lockedBettingVariable.totalBetsSweepCoinAmount =
          Number(lockedBettingVariable.totalBetsSweepCoinAmount) +
          Number(amount);
        lockedBettingVariable.betCountSweepCoin =
          Number(lockedBettingVariable.betCountSweepCoin) + 1;
      }

      // Save updated betting variable
      await queryRunner.manager.save(lockedBettingVariable);

      // Capture roundId for response
      roundIdToUpdate = lockedBettingVariable.roundId;

      // Commit transaction
      await queryRunner.commitTransaction();

      return { bet: savedBet, roundId: roundIdToUpdate };
    } catch (error) {
      // Rollback transaction on failure
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Always release query runner
      await queryRunner.release();
    }
  }
  /**
   * Ensures that the provided bet amount does not exceed the allowed maximum.
   *
   * @param amount - The bet amount to validate.
   * @throws {BadRequestException} If the bet amount exceeds MAX_AMOUNT_FOR_BETTING.
   *
   */
  private enforceMax(amount: number, currencyType: CurrencyType) {
    if (
      amount > MAX_AMOUNT_FOR_BETTING &&
      currencyType === CurrencyType.SWEEP_COINS
    ) {
      throw new BadRequestException(
        `The maximum allowed bet with ${CurrencyTypeText.SWEEP_COINS_TEXT} is ${MAX_AMOUNT_FOR_BETTING.toLocaleString(
          'en-US',
        )}. Your bet amount of ${amount.toLocaleString(
          'en-US',
        )} exceeds this limit. Please place a lower bet.`,
      );
    }
  }

  /**
   * Edits an existing bet for a user.
   *
   * Workflow:
   * 1. Validate the bet (ownership, existence, and active status).
   * 2. Validate the new betting variable, round, and stream status.
   * 3. Run inside a DB transaction:
   *    - Adjust the user’s wallet (refunds/deductions depending on currency/amount changes).
   *    - Update old and/or new betting variable totals and counts with pessimistic locks
   *      to prevent race conditions.
   *    - Save the updated bet with new values.
   * 4. Commit the transaction and emit a potential amount update event for the round.
   *
   * @param userId - The ID of the user editing the bet.
   * @param editBetDto - Contains betId, newCurrencyType, newAmount, newBettingVariableId.
   * @returns The updated bet details and the old betting amount for reference.
   * @throws NotFoundException - If bet or betting variable does not exist.
   * @throws BadRequestException - If bet/round/stream is in an invalid state or input is invalid.
   */
  async editBet(userId: string, editBetDto: EditBetDto) {
    const { newCurrencyType, newAmount, newBettingVariableId, betId } =
      editBetDto;
    this.enforceMax(newAmount, newCurrencyType);

    // Fetch the bet and verify ownership
    const betDetails = await this.betsRepository.findOne({
      where: { id: betId, userId }, // ensure only owner can edit
    });
    const oldBettingAmount = betDetails?.amount;

    if (!betDetails) {
      throw new NotFoundException(`Unable to find the selected bet.`);
    }

    // Ensure the bet is still active
    if (betDetails.status !== BetStatus.Active) {
      const message = await this.bettingStatusMessage(betDetails.status);
      throw new BadRequestException(message);
    }

    // Fetch new betting variable with round + stream relation
    const bettingVariable = await this.bettingVariablesRepository.findOne({
      where: { id: newBettingVariableId },
      relations: ['round', 'round.stream'],
    });

    if (!bettingVariable) {
      throw new NotFoundException(
        `Betting variable with ID ${newBettingVariableId} not found`,
      );
    }

    // Ensure the round is still open
    if (bettingVariable.round.status !== BettingRoundStatus.OPEN) {
      const message = await this.bettingRoundStatusMessage(
        bettingVariable.round.status,
      );
      throw new BadRequestException(message);
    }

    // Ensure stream is not ended
    if (bettingVariable.round.stream.status === StreamStatus.ENDED) {
      throw new BadRequestException(
        `This stream is ended. You can only place bets during live or scheduled streams.`,
      );
    }

    // Start transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let roundIdToUpdate: string | null = null;

    try {
      // --- Wallet Operations ---
      const oldAmount = Number(betDetails.amount);
      const newAmt = Number(newAmount);
      const oldCurrency = betDetails.currency;
      const newCurrency = newCurrencyType;

      // Validate new bet amount and currency type
      if (!Number.isFinite(newAmt) || newAmt <= 0) {
        throw new BadRequestException(
          'New amount must be a positive number greater than 0.',
        );
      }
      if (!Object.values(CurrencyType).includes(newCurrency)) {
        throw new BadRequestException('Invalid currency type.');
      }

      if (newCurrency !== oldCurrency) {
        // Case 1: Currency changed → refund old, deduct new
        if (oldCurrency === CurrencyType.GOLD_COINS) {
          await this.walletsService.addGoldCoins(
            userId,
            oldAmount,
            `Refund from bet currency change: ${oldAmount}`,
            queryRunner.manager,
          );
        } else {
          await this.walletsService.addSweepCoins(
            userId,
            oldAmount,
            `Refund from bet currency change: ${oldAmount}`,
            'refund',
            queryRunner.manager,
          );
        }

        // Deduct new currency
        await this.walletsService.deductForBet(
          userId,
          newAmt,
          newCurrency,
          `Bet amount deducted after currency change: ${newAmt}`,
          queryRunner.manager,
        );
      } else {
        // Case 2: Same currency → adjust only the difference
        const amountDiff = newAmt - oldAmount;
        if (amountDiff > 0) {
          // Deduct extra if new amount is higher
          await this.walletsService.deductForBet(
            userId,
            amountDiff,
            newCurrency,
            `Additional bet amount for edit: ${amountDiff}`,
            queryRunner.manager,
          );
        } else if (amountDiff < 0) {
          // Refund difference if new amount is lower
          const refundAmount = Math.abs(amountDiff);
          if (oldCurrency === CurrencyType.GOLD_COINS) {
            await this.walletsService.addGoldCoins(
              userId,
              refundAmount,
              `Refund from bet edit: ${refundAmount}`,
              queryRunner.manager,
            );
          } else {
            await this.walletsService.addSweepCoins(
              userId,
              refundAmount,
              `Refund from bet edit: ${refundAmount}`,
              'refund',
              queryRunner.manager,
            );
          }
        }
      }

      // --- Betting Variable Updates ---
      // Lock rows to avoid race conditions
      const lockedOldBettingVariable = await queryRunner.manager.findOne(
        BettingVariable,
        {
          where: { id: betDetails.bettingVariableId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      const lockedNewBettingVariable = await queryRunner.manager.findOne(
        BettingVariable,
        {
          where: { id: newBettingVariableId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      if (!lockedOldBettingVariable || !lockedNewBettingVariable) {
        throw new NotFoundException('Betting variable not found');
      }

      const isSameOption =
        lockedOldBettingVariable.id === lockedNewBettingVariable.id;

      // Update betting variable stats based on scenario
      if (isSameOption) {
        // Same option
        if (oldCurrency === newCurrency) {
          // Same currency → adjust totals only
          if (newCurrency === CurrencyType.GOLD_COINS) {
            lockedNewBettingVariable.totalBetsGoldCoinAmount = Math.max(
              0,
              Number(lockedNewBettingVariable.totalBetsGoldCoinAmount) -
              oldAmount +
              newAmt,
            );
          } else {
            lockedNewBettingVariable.totalBetsSweepCoinAmount = Math.max(
              0,
              Number(lockedNewBettingVariable.totalBetsSweepCoinAmount) -
              oldAmount +
              newAmt,
            );
          }
          // counts remain unchanged
        } else {
          // Same option but currency changed → move amounts and counts across currencies
          if (oldCurrency === CurrencyType.GOLD_COINS) {
            lockedNewBettingVariable.totalBetsGoldCoinAmount = Math.max(
              0,
              Number(lockedNewBettingVariable.totalBetsGoldCoinAmount) -
              oldAmount,
            );
            lockedNewBettingVariable.betCountGoldCoin = Math.max(
              0,
              Number(lockedNewBettingVariable.betCountGoldCoin) - 1,
            );
          } else {
            lockedNewBettingVariable.totalBetsSweepCoinAmount = Math.max(
              0,
              Number(lockedNewBettingVariable.totalBetsSweepCoinAmount) -
              oldAmount,
            );
            lockedNewBettingVariable.betCountSweepCoin = Math.max(
              0,
              Number(lockedNewBettingVariable.betCountSweepCoin) - 1,
            );
          }

          // Add to new currency
          if (newCurrency === CurrencyType.GOLD_COINS) {
            lockedNewBettingVariable.totalBetsGoldCoinAmount =
              Number(lockedNewBettingVariable.totalBetsGoldCoinAmount) + newAmt;
            lockedNewBettingVariable.betCountGoldCoin =
              Number(lockedNewBettingVariable.betCountGoldCoin) + 1;
          } else {
            lockedNewBettingVariable.totalBetsSweepCoinAmount =
              Number(lockedNewBettingVariable.totalBetsSweepCoinAmount) +
              newAmt;
            lockedNewBettingVariable.betCountSweepCoin =
              Number(lockedNewBettingVariable.betCountSweepCoin) + 1;
          }
        }
      } else {
        // Different option → subtract from old, add to new
        if (oldCurrency === CurrencyType.GOLD_COINS) {
          lockedOldBettingVariable.totalBetsGoldCoinAmount = Math.max(
            0,
            Number(lockedOldBettingVariable.totalBetsGoldCoinAmount) -
            oldAmount,
          );
          lockedOldBettingVariable.betCountGoldCoin = Math.max(
            0,
            Number(lockedOldBettingVariable.betCountGoldCoin) - 1,
          );
        } else {
          lockedOldBettingVariable.totalBetsSweepCoinAmount = Math.max(
            0,
            Number(lockedOldBettingVariable.totalBetsSweepCoinAmount) -
            oldAmount,
          );
          lockedOldBettingVariable.betCountSweepCoin = Math.max(
            0,
            Number(lockedOldBettingVariable.betCountSweepCoin) - 1,
          );
        }

        if (newCurrency === CurrencyType.GOLD_COINS) {
          lockedNewBettingVariable.totalBetsGoldCoinAmount =
            Number(lockedNewBettingVariable.totalBetsGoldCoinAmount) + newAmt;
          lockedNewBettingVariable.betCountGoldCoin =
            Number(lockedNewBettingVariable.betCountGoldCoin) + 1;
        } else {
          lockedNewBettingVariable.totalBetsSweepCoinAmount =
            Number(lockedNewBettingVariable.totalBetsSweepCoinAmount) + newAmt;
          lockedNewBettingVariable.betCountSweepCoin =
            Number(lockedNewBettingVariable.betCountSweepCoin) + 1;
        }
      }

      // --- Update bet entity ---
      betDetails.amount = newAmount;
      betDetails.currency = newCurrencyType;
      betDetails.bettingVariableId = newBettingVariableId;
      betDetails.roundId = bettingVariable.roundId;

      // Save changes
      await queryRunner.manager.save(betDetails);
      await queryRunner.manager.save(lockedOldBettingVariable);
      await queryRunner.manager.save(lockedNewBettingVariable);

      roundIdToUpdate = lockedNewBettingVariable.roundId;

      // Commit transaction
      await queryRunner.commitTransaction();

      // Emit update event for potential amounts (non-blocking)
      if (roundIdToUpdate) {
        try {
          await this.bettingGateway.emitPotentialAmountsUpdate(roundIdToUpdate);
        } catch (err) {
          Logger.warn(
            `emitPotentialAmountsUpdate failed for round ${roundIdToUpdate}: ${err?.message ?? err}`,
          );
        }
      }

      return { betDetails, oldBettingAmount };
    } catch (error) {
      // Rollback transaction on failure
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Always release query runner
      await queryRunner.release();
    }
  }

  /**
   * Cancels a user's active bet if the round is still open.
   *
   * @param userId - The ID of the user requesting the cancellation
   * @param cancelBetDto - DTO containing the betId to be cancelled
   * @returns The cancelled bet entity
   *
   * @throws NotFoundException - If the bet does not exist or does not belong to the user
   * @throws BadRequestException - If the bet is not active or the round is already closed
   */
  async cancelBet(userId: string, cancelBetDto: CancelBetDto): Promise<Bet> {
    const { betId } = cancelBetDto;

    // Fetch bet with associated stream to validate ownership and existence
    const bet = await this.betsRepository.findOne({
      where: { id: betId, userId },
      relations: ['stream'],
    });

    // If no bet is found, throw an error
    if (!bet) {
      throw new NotFoundException(
        `The bet with ID '${betId}' was not found. It may have been cancelled or removed.`,
      );
    }

    // Ensure the bet is still active (not cancelled, completed, etc.)
    if (bet.status !== BetStatus.Active) {
      const message = await this.bettingStatusMessage(bet.status); // Fetch user-friendly status message
      throw new BadRequestException(message);
    }

    // Fetch the betting round with the specific betting variable related to the bet
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

    // If the betting round is not open, the bet cannot be cancelled
    if (bettingRound.status !== BettingRoundStatus.OPEN) {
      throw new BadRequestException('This round is closed for betting.');
    }

    // Pass required data to handler for bet cancellation (refund, status update, etc.)
    const data = { bettingRound, bet };
    return await this.handleCancelBet(userId, data, bet.currency);
  }

  /**
   * Returns a user-friendly message based on the current betting variable status.
   *
   * @param status - The status of the betting variable (e.g., CREATED, LOCKED, WINNER, etc.)
   * @returns A string message describing why the action cannot proceed or the current state.
   */
  private async bettingRoundStatusMessage(status: string): Promise<string> {
    let message: string;

    switch (status) {
      case BettingVariableStatus.CANCELLED:
        // If the variable has been cancelled, further processing is not allowed
        message = `This bet round has already been cancelled and cannot be processed again.`;
        break;

      case BettingVariableStatus.CREATED:
        // If the variable is created but not yet open for betting
        message = `This betting round has been created but is not yet open for wagers.`;
        break;

      case BettingVariableStatus.LOCKED:
        // If the variable is locked, no more updates or bets are allowed
        message = `This bet round has already been locked and cannot be processed again.`;
        break;

      case BettingVariableStatus.LOSER:
        // If the result has already been declared as a loser
        message = `The result for this bet has already been announced.`;
        break;

      case BettingVariableStatus.WINNER:
        // If the result has already been declared as a winner
        message = `The result for this bet round has already been announced.`;
        break;

      default:
        // Fallback message for unknown or inactive status
        message = `We cannot proceed with your request because this bet Variable is not currently active.`;
    }

    return message;
  }

  /**
   * Returns a user-friendly message based on the current bet status.
   *
   * @param status - The current status of the bet (e.g., Cancelled, Pending, Won, Lost)
   * @returns A string message describing why the action cannot proceed or the current state of the bet
   */
  private async bettingStatusMessage(status: string): Promise<string> {
    let message: string;

    switch (status) {
      case BetStatus.Cancelled:
        // Bet has already been cancelled; cannot perform further actions
        message = `This bet has already been cancelled and cannot be processed again.`;
        break;

      case BetStatus.Pending:
        // Bet is still pending; cannot be processed until resolved
        message = `This bet status is pending and cannot be processed.`;
        break;

      case BetStatus.Lost:
        // Bet has been resolved as lost; further actions not allowed
        message = `The result for this bet has already been announced.`;
        break;

      case BetStatus.Won:
        // Bet has been resolved as won; further actions not allowed
        message = `The result for this bet has already been announced.`;
        break;

      default:
        // Fallback message for unknown or inactive bet statuses
        message = `We cannot proceed with your request because this bet is not currently active.`;
    }

    return message;
  }

  /**
   * Handles the cancellation of a user's bet, including refunding the amount
   * and updating betting variable statistics within a transactional scope.
   *
   * @param userId - ID of the user cancelling the bet
   * @param data - Contains the bet and corresponding betting round
   * @param currencyType - Currency type used for the bet (GOLD_COINS or SWEEP_COINS)
   * @returns The updated Bet entity with status set to Cancelled
   */
  private async handleCancelBet(
    userId: string,
    data: any,
    currencyType: CurrencyType,
  ): Promise<Bet> {
    // Create a database transaction to ensure atomic updates
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { bettingRound, bet } = data;

      // Lock the betting variable row to prevent race conditions while updating totals
      const bettingVariable = await queryRunner.manager
        .getRepository(BettingVariable)
        .createQueryBuilder('bv')
        .where('bv.id = :id', { id: bet.bettingVariableId })
        .setLock('pessimistic_write')
        .getOne();

      if (!bettingVariable) {
        throw new NotFoundException('Betting variable not found for this bet');
      }

      const amount = Number(bet.amount);
      const refundMessage = `Refund ${amount} for canceled bet on ${bettingVariable.name} in stream ${bet.stream.name} (${bettingRound.roundName})`;

      // Refund the user and update betting variable totals depending on currency type
      if (currencyType === CurrencyType.GOLD_COINS) {
        await this.walletsService.addGoldCoins(
          userId,
          bet.amount,
          refundMessage,
          queryRunner.manager,
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
          queryRunner.manager,
        );
        bettingVariable.totalBetsSweepCoinAmount =
          Number(bettingVariable.totalBetsSweepCoinAmount) - amount;
        bettingVariable.betCountSweepCoin -= 1;
      }

      // Mark the bet as cancelled
      bet.status = BetStatus.Cancelled;

      // Save changes within the transaction
      await queryRunner.manager.save(bet);
      await queryRunner.manager.save(bettingVariable);

      // Commit the transaction after successful updates
      await queryRunner.commitTransaction();
      return bet;
    } catch (error) {
      // Rollback transaction in case of errors
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }

  // Result Declaration and Payout
  /**
   * Declares a winner for a given betting variable (option) in a betting round.
   * Handles payouts for winning bets, updates losing bets, closes the round,
   * and emits relevant events and notifications to users.
   *
   * @param variableId - ID of the betting variable that won
   */
  async declareWinner(variableId: string): Promise<void> {
    // Fetch the betting variable and associated round/stream
    const bettingVariable = await this.findBettingVariableById(variableId);

    // Ensure the round is locked before declaring a winner
    this.validateRoundLocked(bettingVariable);

    // Begin a transactional scope to ensure atomic updates
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await this.markWinnerAndLosers(queryRunner, bettingVariable);

      // Fetch all active bets for this variable
      const allStreamBets = await this.fetchActiveBets(
        queryRunner,
        bettingVariable,
      );

      // If there are no active bets, close the round and emit events
      if (!allStreamBets || allStreamBets.length === 0) {
        Logger.log('No active bets found for this round');
        await this.closeRound(queryRunner, bettingVariable);
        await queryRunner.commitTransaction();
        this.bettingGateway.emitWinnerDeclared(
          bettingVariable.stream.id,
          bettingVariable.id,
          bettingVariable.name,
          [], // No winners
          [], // No losers
        );
        this.streamGateway.emitStreamListEvent(StreamList.StreamBetUpdated);
        return;
      }

      const roundCalculation = await this.calculateRoundPayouts(
        bettingVariable.id,
        bettingVariable.round.id,
      );

      const refundAllGoldWinners = roundCalculation.gold.totalLosingBetCount == 0;
      const refundAllSweepWinners = roundCalculation.sweep.totalLosingBetCount == 0;

      const processedBets = [];

      allStreamBets.forEach((item) => {
        let isWon = false;
        let betData = {
          id: item.id,
          userId: item.userId,
          status: BetStatus.Lost,
          currency: item.currency,
          amount: item.amount,
          payoutAmount: 0,
          refundAmount: 0,
          processedAt: new Date(),
          isProcessed: true,
          isFromNoWinners: false,
          originalBet: item,
        };

        const isSweep = betData.currency === "sweep_coins";

        if (item.bettingVariableId === bettingVariable.id) {
          betData.status = BetStatus.Won;
          isWon = true;
        }

        const betAmount = Number(item.amount);
        let refundAllWinners = refundAllSweepWinners;
        let roundData = roundCalculation.sweep;

        if (!isSweep) {
          refundAllWinners = refundAllGoldWinners;
          roundData = roundCalculation.gold;
        }

        const variableData = roundData.round[item.bettingVariableId];

        if (refundAllWinners && isWon) {
          betData.refundAmount = betAmount;
          betData.isFromNoWinners = true;
        } else if (isWon) {
          betData.payoutAmount = (round(betAmount / variableData.totalBetAmount, 2) * variableData.totalPayout) + (variableData.isPayoutLessThanLimit ? betAmount : 0);
        } else {
          betData.refundAmount = round(betAmount / variableData.totalBetAmount, 2) * variableData.totalRefundAmount;
        }

        processedBets.push(betData);
      });

      await this.processClosingBets(
        queryRunner,
        processedBets,
        bettingVariable.round.roundName,
      );

      await this.platformPayoutService.recordPayout(
        queryRunner,
        roundCalculation.sweep.round[bettingVariable.id].totalPlatformSplit,
        bettingVariable,
      );

      // Close the betting round
      await this.closeRound(queryRunner, bettingVariable);

      // Fetch winning bets with user info to send notifications
      const winningBetsWithUserInfo = await queryRunner.manager.find(Bet, {
        where: { bettingVariableId: variableId, status: BetStatus.Won },
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

      // Fetch losing bets with user info from OTHER betting variables only
      const losingBetsWithUserInfo = await queryRunner.manager.find(Bet, {
        where: {
          roundId: bettingVariable.roundId,
          status: BetStatus.Lost,
          bettingVariableId: Not(variableId) // Only bets on non-winning options
        },
        relations: ['user', 'bettingVariable', 'round'],
      });

      const losers = losingBetsWithUserInfo.map((bet) => ({
        userId: bet.userId,
        username: bet.user?.username,
      }));

      // Commit the transaction after processing all bets
      await queryRunner.commitTransaction();

      // Emit events for frontend and bot notifications
      this.bettingGateway.emitWinnerDeclared(
        bettingVariable.stream.id,
        bettingVariable.id,
        bettingVariable.name,
        winners,
        losers,
        {
          goldCoin:
            roundCalculation.gold.totalWinningBetCount === 0 || roundCalculation.gold.totalLosingBetCount === 0,
          sweepCoin:
            roundCalculation.sweep.totalWinningBetCount === 0 || roundCalculation.sweep.totalLosingBetCount === 0,
        },
      );
      this.streamGateway.emitStreamListEvent(StreamList.StreamBetUpdated);

      // Send "Winner Declared" message to all participants (winners + losers) in parallel
      // Using allSettled to ensure all notifications are attempted even if some fail
      const allParticipants = [...winners, ...losers];
      const winnerDeclarationResults = await Promise.allSettled(
        allParticipants.map((participant) =>
          this.bettingGateway.emitBotMessageForWinnerDeclaration(
            participant.userId,
            participant.username,
            bettingVariable.name,
          ),
        ),
      );

      // Log any failed "Winner Declared" notifications
      winnerDeclarationResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const participant = allParticipants[index];
          Logger.error(
            `Failed to send "Winner Declared" notification to user ${participant.userId} (${participant.username})`,
            result.reason,
          );
        }
      });

      // Notify winners via bot and store results in Redis for summary email
      const winnerNotificationResults = await Promise.allSettled(
        winners.map(async (winner) => {
          const notificationResults = await Promise.allSettled([
            this.bettingGateway.emitBotMessageToWinner(
              winner.userId,
              winner.username,
              winner.roundName,
              winner.amount,
              winner.currencyType,
            ),
            this.bettingSummaryService.addBettingResult(
              bettingVariable.stream.id,
              bettingVariable.stream.name,
              winner.userId,
              winner.roundName,
              'won',
              winner.amount,
              winner.currencyType,
            ),
          ]);

          // Log any individual failures (bot notification or Redis storage)
          notificationResults.forEach((result, notifIndex) => {
            if (result.status === 'rejected') {
              const notifType = notifIndex === 0 ? 'bot message' : 'Redis storage';
              Logger.error(
                `Failed to send ${notifType} to winner ${winner.userId} (${winner.username})`,
                result.reason,
              );
            }
          });

          return winner; // Return winner for outer error logging
        }),
      );

      // Log any failed winner notification batches (outer failures)
      winnerNotificationResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const winner = winners[index];
          Logger.error(
            `Failed to send winner notification batch to user ${winner.userId} (${winner.username})`,
            result.reason,
          );
        }
      });

      // Notify losers via bot and store results in Redis for summary email
      if (roundCalculation.gold.totalWinningBetCount > 0 || roundCalculation.sweep.totalWinningBetCount > 0) {
        const loserNotificationResults = await Promise.allSettled(
          losingBetsWithUserInfo.map(async (bet) => {
            const notificationResults = await Promise.allSettled([
              this.bettingGateway.emitBotMessageToLoser(
                bet.userId,
                bet.user?.username,
                bet.round.roundName,
              ),
              this.bettingSummaryService.addBettingResult(
                bettingVariable.stream.id,
                bettingVariable.stream.name,
                bet.userId,
                bet.round.roundName,
                'lost',
                bet.amount,
                bet.currency,
              ),
            ]);

            // Log any individual notification failures for this user
            notificationResults.forEach((result, notifIndex) => {
              if (result.status === 'rejected') {
                const notifType = notifIndex === 0 ? 'bot message' : 'Redis storage';
                Logger.error(
                  `Failed to send ${notifType} to loser ${bet.userId} (${bet.user?.username})`,
                  result.reason,
                );
              }
            });

            return bet; // Return bet for outer error logging
          }),
        );

        // Log any failed loser notification batches (outer failures)
        loserNotificationResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            const bet = losingBetsWithUserInfo[index];
            Logger.error(
              `Failed to send loser notification batch to user ${bet.userId} (${bet.user?.username})`,
              result.reason,
            );
          }
        });
      }

      // Track all participants for this stream to send summary emails when stream ends
      const participants = [
        ...winners.map((w) => w.userId),
        ...losingBetsWithUserInfo.map((b) => b.userId),
      ];

      if (participants.length > 0) {
        await this.bettingSummaryService
          .addStreamParticipants(bettingVariable.stream.id, participants)
          .catch((error) =>
            Logger.error(
              `Failed to track participants for stream ${bettingVariable.stream.id}`,
              error,
            ),
          );
      }
    } catch (error) {
      // Rollback transaction in case of any errors
      await queryRunner.rollbackTransaction();
      console.error('Error in declareWinner:', error);
      throw error;
    } finally {
      // Release query runner
      await queryRunner.release();
    }
  }

  private calculatePerCurrencyRoundPayout(currency, winningOptions, losingOptions) {
    const MAX_PAYOUT = 4;

    const betAmountVariable = currency == "sweep" ? "totalBetsSweepCoinAmount" : "totalBetsGoldCoinAmount";
    const betCountVariable = currency == "sweep" ? "betCountSweepCoin" : "betCountGoldCoin";

    const totalWinningBetAmount = Number(winningOptions[betAmountVariable]);
    const totalLosingBetAmount = losingOptions.reduce((sum, item) => sum += Number(item[betAmountVariable]), 0);

    const totalWinningBetCount = Number(winningOptions[betCountVariable]);
    const totalLosingBetCount = losingOptions.reduce((sum, item) => sum += Number(item[betCountVariable]), 0);

    const potentialPayout = totalWinningBetAmount * MAX_PAYOUT;
    const totalWinningPayout = potentialPayout <= totalLosingBetAmount
      ? potentialPayout
      : totalLosingBetAmount;

    const totalPlatformSplit = totalWinningPayout * (currency == "sweep" ? 0.15 : 0);

    let perRoundData = [{
      id: winningOptions.id,
      totalBetAmount: Number(winningOptions[betAmountVariable]),
      totalPayout: totalWinningPayout - totalPlatformSplit,
      totalPlatformSplit: totalPlatformSplit,
      totalRefundAmount: 0,
      isPayoutLessThanLimit: potentialPayout > totalWinningPayout
    }];

    losingOptions.forEach((item) => {
      perRoundData.push({
        id: item.id,
        totalBetAmount: Number(item[betAmountVariable]),
        totalPayout: 0,
        totalPlatformSplit: 0,
        totalRefundAmount: 0,
        isPayoutLessThanLimit: false
      })
    })

    if (potentialPayout < totalLosingBetAmount) {
      const totalPayout = totalWinningPayout - totalWinningBetAmount;
      const totalAmountToSplit = totalLosingBetAmount - totalPayout;

      perRoundData = perRoundData.map((item) => {
        if (item.id !== winningOptions.id) {
          item.totalRefundAmount = (round(item.totalBetAmount / totalLosingBetAmount, 2) * totalAmountToSplit);
        }

        return item;
      })
    }

    const summarizedRoundData = {};

    perRoundData.forEach((item) => {
      summarizedRoundData[item.id] = item;
    })

    return {
      round: summarizedRoundData,
      totalWinningBetAmount,
      totalLosingBetAmount,
      totalWinningBetCount,
      totalLosingBetCount
    };
  }

  private async calculateRoundPayouts(winningOption, betRound) {
    const variables = await this.bettingVariablesRepository.find({
      where: {
        roundId: betRound
      }
    });

    const winningOptions = variables.filter((item) => item.id == winningOption).at(0);
    const losingOptions = variables.filter((item) => item.id != winningOption);

    const sweepCalculation = this.calculatePerCurrencyRoundPayout("sweep", winningOptions, losingOptions);
    const goldCalculation = this.calculatePerCurrencyRoundPayout("gold", winningOptions, losingOptions);

    return {
      sweep: sweepCalculation,
      gold: goldCalculation,
    }
  }

  /**
   * Validates that a betting round is locked and ready for declaring a winner.
   * Throws exceptions if the betting variable or its associated round is invalid
   * or if the round status is not suitable for winner declaration.
   *
   * @param bettingVariable - The betting variable to validate
   * @throws BadRequestException if validation fails
   */
  private validateRoundLocked(bettingVariable: BettingVariable) {
    // Ensure a betting variable is provided
    if (!bettingVariable) {
      throw new BadRequestException('Betting variable is required');
    }

    // Ensure the betting variable is associated with a round
    if (!bettingVariable.round) {
      throw new BadRequestException(
        'Betting variable must have an associated round',
      );
    }

    // Check if the round is already closed
    if (bettingVariable.round.status === BettingRoundStatus.CLOSED) {
      throw new BadRequestException(
        'This round is already closed. Winner has already been declared for this round.',
      );
    }

    // Ensure the round is locked before declaring a winner
    if (bettingVariable.round.status !== BettingRoundStatus.LOCKED) {
      throw new BadRequestException(
        'Betting round must be locked before declaring a winner',
      );
    }
  }

  /**
   * Marks the provided betting variable as the winner and updates
   * all other variables in the same round as losers.
   *
   * @param queryRunner - TypeORM query runner for transactional operations
   * @param bettingVariable - The betting variable to mark as winner
   */
  private async markWinnerAndLosers(
    queryRunner,
    bettingVariable: BettingVariable,
  ) {
    // Mark the current variable as the winning option
    bettingVariable.status = BettingVariableStatus.WINNER;
    bettingVariable.is_winning_option = true;
    await queryRunner.manager.save(bettingVariable);

    // Mark all other variables in the same round as losers
    await queryRunner.manager.update(
      BettingVariable,
      {
        round: { id: bettingVariable.round.id }, // Filter by same round
        id: Not(bettingVariable.id), // Exclude the winning variable
      },
      { status: BettingVariableStatus.LOSER }, // Set status to LOSER
    );
  }

  /**
   * Fetches all active bets for a given betting variable within its stream and round.
   *
   * @param queryRunner - TypeORM query runner for transactional operations
   * @param bettingVariable - The betting variable whose active bets should be fetched
   * @returns Array of active Bet entities, filtered for validity
   */
  private async fetchActiveBets(queryRunner, bettingVariable: BettingVariable) {
    try {
      // Ensure the provided betting variable has necessary references
      if (
        !bettingVariable ||
        !bettingVariable.stream ||
        !bettingVariable.roundId
      ) {
        Logger.log('Invalid bettingVariable provided to fetchActiveBets');
        return [];
      }

      // Fetch bets that are active, belong to the same round, and are in the same stream
      const bets = await queryRunner.manager.find(Bet, {
        where: {
          bettingVariable: { stream: { id: bettingVariable.stream.id } }, // Stream filter
          roundId: bettingVariable.roundId, // Round filter
          status: BetStatus.Active, // Only active bets
        },
        relations: ['bettingVariable', 'round'], // Include related entities
      });

      // Filter out any invalid or incomplete bets
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
      // Log error and return empty array if something goes wrong
      console.error('Error fetching active bets:', error);
      return [];
    }
  }

  private async processRefund(queryRunner, betData, description, bettingVariableName) {
    await this.walletsService.updateBalance(
      betData.userId,
      betData.refundAmount,
      betData.currency,
      TransactionType.REFUND,
      description,
      undefined,
      undefined,
      queryRunner.manager,
    );

    const userObj = await this.usersService.findUserByUserId(betData.userId);

    await this.bettingGateway.emitBotMessageVoidRound(
      betData.userId,
      userObj.username,
      bettingVariableName,
    )
  }

  private async processClosingBets(
    queryRunner,
    betData,
    bettingVariableName
  ) {
    for (const bet of betData) {
      const originalBet = bet.originalBet;

      originalBet.status = bet.status;
      originalBet.payoutAmount = bet.payoutAmount;
      originalBet.refundAmount = bet.refundAmount;
      originalBet.processedAt = bet.processedAt;
      originalBet.isProcessed = bet.isProcessed;

      const isFromNoWinners = bet.isFromNoWinners;

      await queryRunner.manager.save(originalBet);

      if (isFromNoWinners) {
        await this.processRefund(
          queryRunner,
          bet,
          `${bet.refundAmount} ${bet.currency} refunded - bet round closed with no winners.`,
          bettingVariableName
        )
      } else {
        if (bet.status === BetStatus.Won) {
          if (bet.payoutAmount > 0) {
            await this.walletsService.creditWinnings(
              bet.userId,
              bet.payoutAmount,
              bet.currency,
              `Winnings from bet on ${bettingVariableName}`,
              queryRunner.manager,
            );
          }

          if (bet.refundAmount > 0) {
            await this.processRefund(
              queryRunner,
              bet,
              `${bet.refundAmount} ${bet.currency} refunded - refunded due to 4:1 odds limit.`,
              bettingVariableName
            )
          }
        } else if (bet.status === BetStatus.Lost) {

          await this.walletsService.createTransactionData(
            bet.userId,
            TransactionType.BET_LOST,
            bet.currency,
            bet.amount,
            `${bet.amount} ${bet.currency} debited - bet lost.`,
            queryRunner.manager,
          );

          if (bet.refundAmount > 0) {
            await this.processRefund(
              queryRunner,
              bet,
              `${bet.refundAmount} ${bet.currency} refunded - refunded due to 4:1 odds limit.`,
              bettingVariableName
            )
          }
        }
      }
    }
  }

  /**
   * Closes a betting round associated with a betting variable.
   * Marks the round status as CLOSED and saves it in the database using the provided queryRunner.
   *
   * @param queryRunner - TypeORM QueryRunner to handle the database transaction
   * @param bettingVariable - The betting variable whose round needs to be closed
   */
  private async closeRound(queryRunner, bettingVariable: BettingVariable) {
    // Retrieve the round from the betting variable if available
    let round = bettingVariable.round;

    // If round is not attached to the variable, fetch it from the repository
    if (!round) {
      round = await this.bettingRoundsRepository.findOne({
        where: { id: bettingVariable.roundId },
      });
    }

    // If round exists, update its status to CLOSED
    if (round) {
      round.status = BettingRoundStatus.CLOSED;
      // Save the updated round within the current transaction
      await queryRunner.manager.save(round);
    }
  }

  // Utility Methods
  /**
   * Locks a betting variable to prevent further bets from being placed.
   * Typically called before declaring a winner for the associated round.
   *
   * @param variableId - The ID of the betting variable to lock
   * @returns The updated BettingVariable entity with status set to LOCKED
   */
  async lockBetting(variableId: string): Promise<BettingVariable> {
    // Update the status of the betting variable to LOCKED
    // Delegates the actual update to a helper method `updateBettingVariableStatus`
    const updatedVariable = await this.updateBettingVariableStatus(
      variableId,
      BettingVariableStatus.LOCKED,
    );

    // Fetch the betting variable with relations to get stream and round info
    const bettingVariable = await this.findBettingVariableById(variableId);

    // Emit socket events to notify frontend of the status change
    if (bettingVariable.stream && bettingVariable.roundId) {
      // Emit betting locked event to the specific stream
      this.bettingGateway.emitBettingStatus(
        bettingVariable.stream.id,
        bettingVariable.roundId,
        BettingRoundStatus.LOCKED,
      );

      // Emit stream list update event to all clients in 'streambet' room
      this.streamGateway.emitStreamListEvent(StreamList.StreamBetUpdated);
    } else {
      Logger.warn(
        `[lockBetting] Missing stream or roundId - cannot emit events`,
      );
    }

    return updatedVariable;
  }

  /**
   * Fetches all bets for a specific user, optionally filtering only active bets.
   *
   * @param userId - The ID of the user whose bets are being fetched
   * @param active - Optional flag to fetch only active bets (default: false)
   * @returns A promise that resolves to an array of Bet entities
   */
  async getUserBets(userId: string, active: boolean = false): Promise<Bet[]> {
    // Initialize the base where clause with the userId
    const whereClause: Record<string, unknown> = { userId };

    Logger.log('Fetching user bets...'); // Debug log

    // If the active flag is true, add a status filter for active bets
    if (active) {
      whereClause.status = BetStatus.Active;
    }

    // Fetch bets from the repository
    // Include relations for bettingVariable and its associated stream
    // Order the results by creation date descending (most recent first)
    return this.betsRepository.find({
      where: whereClause,
      relations: ['bettingVariable', 'bettingVariable.stream'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Fetches all betting variables (options) along with their bets for a specific stream.
   *
   * @param streamId - The ID of the stream whose betting variables and bets are being fetched
   * @returns A promise that resolves to an array of BettingVariable entities with their associated bets
   */
  async getStreamBets(streamId: string): Promise<BettingVariable[]> {
    // Fetch betting variables for the given stream ID
    // Include all associated bets for each betting variable
    return this.bettingVariablesRepository.find({
      where: { stream: { id: streamId } },
      relations: ['bets'], // Eager load all bets associated with each betting variable
    });
  }

  /**
   * Retrieves a bet by its ID along with its related entities.
   *
   * @param betId - The unique identifier of the bet to fetch
   * @returns A promise that resolves to the Bet entity, including its betting variable, round, and stream
   * @throws NotFoundException if the bet with the given ID does not exist
   */
  async getBetById(betId: string): Promise<Bet> {
    // Fetch the bet by ID, including relations: betting variable, its round, and the stream
    const bet = await this.betsRepository.findOne({
      where: { id: betId },
      relations: ['bettingVariable', 'bettingVariable.round', 'stream'],
    });

    // Throw an error if the bet is not found
    if (!bet) {
      throw new NotFoundException(`Bet with ID ${betId} not found`);
    }

    return bet;
  }

  /**
   * Finds the potential winning amount for a user's active bet in a given round.
   *
   * @param userId - The ID of the user
   * @param roundId - The ID of the betting round
   * @returns An object containing bet details and potential winnings, or null if no active bet exists
   * @throws NotFoundException if any error occurs while fetching bet or round data
   */
  async findPotentialAmount(userId: string, roundId: string) {
    try {
      // Fetch the betting round along with its betting variables
      const bettingRound = await this.bettingRoundsRepository.findOne({
        where: { id: roundId },
        relations: ['bettingVariables'],
      });

      // Fetch the user's active bet in this round with variable details
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

      // Return null if no active bet is found
      if (!bets || bets.betstatus !== BetStatus.Active) {
        return null;
      }

      // Calculate potential winnings for Gold Coins and Sweep Coins
      const { potentialSweepCoinAmt, potentialGoldCoinAmt, betAmount } =
        this.potentialAmountCal(bettingRound, bets);

      // Return structured response
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
      console.error('Error fetching potential amount:', e.message);
      throw new NotFoundException(e.message);
    }
  }

  /**
   * Calculates potential winning amounts for all active bets in a given betting round.
   *
   * @param roundId - The ID of the betting round
   * @returns An array of objects containing user bet details and potential winnings
   * @throws NotFoundException if the betting round does not exist or an error occurs
   */
  async findPotentialAmountsForAllUsers(roundId: string) {
    try {
      // Fetch the betting round along with its betting variables
      const bettingRound = await this.bettingRoundsRepository.findOne({
        where: { id: roundId },
        relations: ['bettingVariables'],
      });

      if (!bettingRound) {
        throw new NotFoundException(`Round with ID ${roundId} not found`);
      }

      // Fetch all active bets for this round along with user and variable details
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
          'bettingVariable.total_bets_gold_coin_amount AS variableTotalGoldCoins',
          'bettingVariable.total_bets_sweep_coin_amount AS variableTotalSweepCoins',
          'bettingVariable.bet_count_gold_coin AS betCountFreeGoldCoin',
          'bettingVariable.bet_count_sweep_coin AS betCountSweepCoin',
        ])
        .getRawMany();

      const potentialAmounts = [];

      // Iterate through each active bet to calculate potential winnings
      for (const bet of allBets) {
        if (bet.betstatus === BetStatus.Active) {
          try {
            // Calculate potential winnings for Gold Coins and Sweep Coins
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
            // Continue processing other bets even if one fails
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

      const opposingOptions = bettingVariables.filter(
        (item) => item.id !== userOption.id,
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

      const opposingGoldCoinAmount = opposingOptions.reduce(
        (sum, v) => sum + Number(v.totalBetsGoldCoinAmount || 0),
        0,
      );

      const opposingPotSweepCoinAmount = opposingOptions.reduce(
        (sum, v) => sum + Number(v.totalBetsSweepCoinAmount || 0),
        0,
      );

      const opposingPotSweepCoinAmountAfterPlatformFee =
        opposingPotSweepCoinAmount * 0.85;

      const goldPotPerBettor =
        userOptionGoldCoinCount > 0
          ? round(opposingGoldCoinAmount / userOptionGoldCoinCount, 2)
          : 0;
      const sweepPotPerBettor =
        userOptionSweepCoinCount > 0
          ? round(
            opposingPotSweepCoinAmountAfterPlatformFee /
            userOptionSweepCoinCount,
            2,
          )
          : 0;

      console.log({
        opposingGoldCoinAmount,
        userOptionGoldCoinCount,
        goldPotPerBettor,
        userOptionSweepCoinCount,
        opposingPotSweepCoinAmount,
        sweepPotPerBettor,
      });

      // --- MAIN LOGIC: always calculate from scratch ---
      let potentialGoldCoinAmt = goldCoinBetAmtForLoginUser;

      if (
        bets.betcurrency === CurrencyType.GOLD_COINS &&
        userOptionGoldCoinCount > 0
      ) {
        potentialGoldCoinAmt += goldPotPerBettor;
      }

      let potentialSweepCoinAmt = sweepCoinBetAmtForLoginUser;

      if (
        bets.betcurrency === CurrencyType.SWEEP_COINS &&
        userOptionSweepCoinCount > 0
      ) {
        potentialSweepCoinAmt += sweepPotPerBettor;
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

  /**
   * Updates the status of a betting round while enforcing allowed transitions.
   *
   * Allowed transitions:
   *   - 'created' -> 'open'
   *   - 'open' -> 'locked'
   *
   * Emits relevant websocket events to notify users of status changes.
   *
   * @param roundId - ID of the betting round
   * @param newStatus - New status to set ('created' | 'open' | 'locked')
   * @returns The updated BettingRound entity
   * @throws NotFoundException if the round does not exist or cannot be locked due to insufficient bets
   * @throws BadRequestException if the status transition is invalid
   */
  async updateRoundStatus(
    roundId: string,
    newStatus: 'created' | 'open' | 'locked',
  ): Promise<BettingRound> {
    // Fetch the round by ID
    const round = await this.bettingRoundsRepository.findOne({
      where: { id: roundId },
    });
    if (!round) {
      throw new NotFoundException(`Round with ID ${roundId} not found`);
    }

    const current = round.status;
    let savedRound;

    // Only allow valid transitions: created -> open -> locked
    if (
      (current === 'created' && newStatus === 'open') ||
      (current === 'open' && newStatus === 'locked')
    ) {
      // Lock the round
      if (newStatus === BettingRoundStatus.LOCKED) {
        // Fetch round with stream info
        const roundWithStream = await this.bettingRoundsRepository.findOne({
          where: { id: roundId },
          relations: ['stream'],
        });

        if (roundWithStream && roundWithStream.streamId) {
          // Update status and save
          round.status = newStatus as any;
          savedRound = await this.bettingRoundsRepository.save(round);

          // Emit websocket events for the stream
          await this.bettingGateway.emitBettingStatus(
            roundWithStream.streamId,
            roundId,
            BettingRoundStatus.LOCKED,
            true,
          );

          // Notify individual users whose bets are in this round
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

      // Open the round
      if (newStatus === BettingRoundStatus.OPEN) {
        round.status = newStatus as any;
        savedRound = await this.bettingRoundsRepository.save(round);

        const roundWithStream = await this.bettingRoundsRepository.findOne({
          where: { id: roundId },
          relations: ['stream'],
        });

        if (roundWithStream && roundWithStream.streamId) {
          // Emit websocket events for the stream
          await this.bettingGateway.emitBettingStatus(
            roundWithStream.streamId,
            roundId,
            BettingRoundStatus.OPEN,
          );
          await this.bettingGateway.emitOpenBetRound(
            round.roundName,
            roundWithStream.stream.name,
          );
        }
      }

      // Update stream list for frontend
      this.streamGateway.emitStreamListEvent(StreamList.StreamBetUpdated);

      return savedRound;
    } else {
      throw new BadRequestException(
        `Invalid status transition from ${current} to ${newStatus}. Allowed: created -> open -> locked.`,
      );
    }
  }

  /**
   * Cancels a betting round and refunds all active bets.
   *
   * Steps:
   *   1. Fetch the round along with its betting variables and associated bets.
   *   2. Set the round status to CANCELLED.
   *   3. Loop through each betting variable:
   *       - Set its status to CANCELLED.
   *       - Loop through each bet:
   *           - Skip non-active bets.
   *           - Refund the amount to the user based on currency type.
   *           - Update variable totals accordingly.
   *           - Update bet status to Cancelled.
   *           - Emit bot messages notifying users of refund.
   *   4. Commit the transaction.
   *   5. Emit betting status and stream list events to update front-end.
   *
   * @param roundId - ID of the betting round to cancel
   * @returns Object containing refunded bets
   * @throws NotFoundException if the betting round does not exist
   */
  async cancelRoundAndRefund(
    roundId: string,
  ): Promise<{ refundedBets: Bet[] }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Fetch the round with its variables and associated bets
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
          // Skip bets that are not active
          if (bet.status !== BetStatus.Active) continue;

          // Fetch username for notifications
          const { username } = await this.usersService.findUserByUserId(
            bet.userId,
          );

          // Refund user based on currency type and update totals
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

          // Mark bet as cancelled
          bet.status = BetStatus.Cancelled;
          refundedBets.push(bet);
          await queryRunner.manager.save(bet);

          // Emit bot message notifying user of refund
          await this.bettingGateway.emitBotMessageForCancelBetByAdmin(
            bet.userId,
            username,
            bet.amount,
            bet.currency,
            variable.name,
            round.roundName,
          );
        }

        // Save updated betting variable totals and status
        await queryRunner.manager.save(variable);
      }

      // Commit the transaction
      await queryRunner.commitTransaction();

      // Emit round-level events if stream exists
      if (round.streamId) {
        await this.bettingGateway.emitBettingStatus(
          round.streamId,
          roundId,
          BettingRoundStatus.CANCELLED,
        );
      }

      // Update stream list for frontend
      this.streamGateway.emitStreamListEvent(StreamList.StreamBetUpdated);

      return { refundedBets };
    } catch (error) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Calculates total bets and total bet counts for a given betting round.
   *
   * @param roundId - ID of the round for which totals are calculated
   * @returns Object containing:
   *   - totalBetsGoldCoinAmount: total Gold Coins bet in this round
   *   - totalBetsSweepCoinAmount: total Sweep Coins bet in this round
   *   - totalGoldCoinBet: total number of Gold Coin bets
   *   - totalSweepCoinBet: total number of Sweep Coin bets
   */
  async getRoundTotals(roundId: string) {
    // Fetch all betting variables associated with this round
    const bettingVariables = await this.bettingVariablesRepository.find({
      where: { roundId },
    });

    // Sum up total Gold Coins bet across all variables
    const totalBetsGoldCoinAmount = bettingVariables.reduce(
      (sum, v) => Number(sum) + Number(v.totalBetsGoldCoinAmount || 0),
      0,
    );

    // Sum up total Sweep Coins bet across all variables
    const totalBetsSweepCoinAmount = bettingVariables.reduce(
      (sum, v) => Number(sum) + Number(v.totalBetsSweepCoinAmount || 0),
      0,
    );

    // Sum total number of Gold Coin bets
    const totalGoldCoinBet = bettingVariables.reduce(
      (sum, v) => Number(sum) + Number(v.betCountGoldCoin || 0),
      0,
    );

    // Sum total number of Sweep Coin bets
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

  /**
   * Returns the total number of active bets in the system.
   *
   * @returns Promise<number> - count of bets with status 'Active'
   */
  getActiveBetsCount(): Promise<number> {
    // Count all bets where status is Active
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

  /**
   * Retrieves a user's betting history with optional search, sorting, and pagination.
   *
   * - Search: `filter.q` matches stream name (case-insensitive)
   * - Sort: `sort` applies on bet created date (createdAt / created_at)
   * - Pagination: `range` as [offset, limit]; disable via `pagination=false`
   */
  async getUserBettingHistory(
    userId: string,
    betHistoryFilterDto: BetHistoryFilterDto,
  ): Promise<{ data: any[]; total: number }> {
    try {
      const sort: Sort = betHistoryFilterDto?.sort
        ? (JSON.parse(betHistoryFilterDto.sort) as Sort)
        : (['createdAt', 'DESC'] as unknown as Sort);
      const range: Range = betHistoryFilterDto?.range
        ? (JSON.parse(betHistoryFilterDto.range) as Range)
        : [0, 24];
      const { pagination = true } = betHistoryFilterDto || {};
      const filter: FilterDto = betHistoryFilterDto?.filter
        ? (JSON.parse(betHistoryFilterDto.filter) as FilterDto)
        : undefined;

      // Base query joining stream, round, and betting variable
      const qb = this.betsRepository
        .createQueryBuilder('b')
        .leftJoin('b.stream', 's')
        .leftJoin('b.round', 'r')
        .leftJoin('b.bettingVariable', 'bv')
        .where('b.userId = :userId', { userId });

      if (filter?.q) {
        qb.andWhere('(LOWER(s.name) ILIKE LOWER(:q))', { q: `%${filter.q}%` });
      }

      // Ordering by bet creation date
      if (sort) {
        const [sortColumn, sortOrder] = sort;
        const column = sortColumn === 'created_at' ? 'created_at' : 'createdAt';
        qb.orderBy(
          `b.${column}`,
          String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC',
        );
      }

      // Select requested fields in required schema
      qb.select('b.createdAt', 'date')
        .addSelect('s.name', 'streamName')
        .addSelect('r.roundName', 'roundName')
        .addSelect('bv.name', 'optionName')
        .addSelect('b.currency', 'coinType')
        .addSelect('b.amount', 'amountPlaced')
        .addSelect(
          `CASE WHEN b.status = :won THEN b.payoutAmount ELSE 0 END`,
          'amountWon',
        )
        .addSelect(
          `CASE WHEN b.status = :lost THEN b.amount ELSE 0 END`,
          'amountLost',
        )
        .addSelect('b.status', 'status')
        .setParameters({ won: BetStatus.Won, lost: BetStatus.Lost });

      // Count query for pagination total
      const countQB = this.betsRepository
        .createQueryBuilder('b')
        .leftJoin('b.stream', 's')
        .where('b.userId = :userId', { userId });

      if (filter?.q) {
        countQB.andWhere('(LOWER(s.name) ILIKE LOWER(:q))', {
          q: `%${filter.q}%`,
        });
      }

      const total = await countQB.getCount();

      if (pagination && range) {
        const [offset, limit] = range;
        qb.offset(offset).limit(limit);
      }

      const data = await qb.getRawMany();
      return { data, total };
    } catch (e) {
      Logger.error('Unable to retrieve betting history', e);
      throw new InternalServerErrorException(
        'Unable to retrieve betting history at the moment. Please try again later',
      );
    }
  }
}
