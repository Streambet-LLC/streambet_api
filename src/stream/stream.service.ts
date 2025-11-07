import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
  OnModuleDestroy,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Stream } from './entities/stream.entity';
import {
  LiveScheduledStreamListDto,
  StreamFilterDto,
} from './dto/list-stream.dto';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { UpdateStreamDto } from '../betting/dto/update-stream.dto';
import { WalletsService } from 'src/wallets/wallets.service';
import { Wallet } from 'src/wallets/entities/wallet.entity';
import { BettingRoundStatus } from 'src/enums/round-status.enum';
import { BetStatus } from 'src/enums/bet-status.enum';
import { PlatformName } from 'src/enums/platform-name.enum';
import { QueueService } from 'src/queue/queue.service';
import { BettingService } from 'src/betting/betting.service';
import { StreamEventType, StreamList, StreamStatus } from 'src/enums/stream.enum';
import { STREAM_LIVE_QUEUE } from 'src/common/constants/queue.constants';
import { StreamDetailsDto } from './dto/stream-detail.response.dto';
import { StreamGateway } from './stream.gateway';
import { CurrencyType } from 'src/enums/currency.enum';
import { User } from 'src/users/entities/user.entity';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { BettingVariable } from 'src/betting/entities/betting-variable.entity';
import { HomepageBetListDto } from './dto/homepage-bet-list.dto';

@Injectable()
export class StreamService implements OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(StreamService.name);
  private updateTimers = new Map<string, NodeJS.Timeout>();
  private latestCounts = new Map<string, number>();
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
    @InjectRepository(BettingVariable)
    private bettingVariableRepository: Repository<BettingVariable>,
    @InjectRepository(BettingRound)
    private bettingRoundRepository: Repository<BettingRound>,
    private walletService: WalletsService,
    @Inject(forwardRef(() => BettingService))
    private bettingService: BettingService,
    @Inject(forwardRef(() => StreamGateway))
    private streamGateway: StreamGateway,
    private dataSource: DataSource,
    private queueService: QueueService,
  ) { }
  async onModuleDestroy() {
    await this.flushViewerCounts('moduleDestroy');
  }
  /**
   * Retrieves a paginated list of streams for the home page view.
   * Applies optional filters such as stream status and sorting based on the provided DTO.
   * Selects limited fields (id, name, thumbnailUrl) for performance optimization.
   * Handles pagination with a default range of [0, 24] if not specified.
   * Logs and throws an HttpException in case of internal server errors.
   *
   * @param streamFilterDto - DTO containing optional filters: status, sort, and pagination range.
   * @returns A Promise resolving to an object with:
   *          - data: Array of stream records with selected fields.
   *          - total: Total number of matching stream records.
   * @throws HttpException - If an error occurs during query execution.
   * @author Reshma M S
   */

  async homePageStreamList(
    streamFilterDto: StreamFilterDto,
  ): Promise<{ data: Stream[]; total: number }> {
    try {
      const sort: Sort = streamFilterDto.sort
        ? (JSON.parse(streamFilterDto.sort) as Sort)
        : undefined;
      const range: Range = streamFilterDto.range
        ? (JSON.parse(streamFilterDto.range) as Range)
        : [0, 24];

      const { pagination = true, streamStatus, username } = streamFilterDto;

      const streamQB = this.streamsRepository
        .createQueryBuilder('s');

      if (username) {
        streamQB.innerJoinAndSelect('s.creator', 'creator', 'creator.username = :username')
          .setParameter('username', username);
      } else {
        streamQB.leftJoinAndSelect('s.creator', 'creator');
      };

      streamQB.leftJoinAndSelect(
        's.bettingRounds',
        'br',
        'br.status IN (:...roundStatuses)',
        {
          roundStatuses: [BettingRoundStatus.OPEN, BettingRoundStatus.LOCKED],
        },
      )
        .leftJoinAndSelect('br.bettingVariables', 'bv')
        .select('s.id', 'id')
        .addSelect('s.name', 'streamName')
        .addSelect('s.thumbnailUrl', 'thumbnailURL')
        .addSelect('s.scheduledStartTime', 'scheduledStartTime')
        .addSelect('s.endTime', 'endTime')
        .addSelect('creator.username', 'creatorUsername')
        .addSelect(
          'COALESCE(SUM(bv.totalBetsGoldCoinAmount), 0)',
          'totalBetsGoldCoinAmount',
        )
        .addSelect(
          'COALESCE(SUM(bv.totalBetsSweepCoinAmount), 0)',
          'totalBetsSweepCoinAmount',
        )
        .groupBy('s.id, creator.username');

      if (streamStatus) {
        streamQB.andWhere(`s.status = :streamStatus`, { streamStatus });
      }
      if (sort) {
        const [sortColumn, sortOrder] = sort;
        streamQB.orderBy(
          `s.${sortColumn}`,
          sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
        );
      }
      if (pagination && range) {
        const [offset, limit] = range;
        streamQB.offset(offset).limit(limit);
      }

      const total = await streamQB.getCount();
      const data = await streamQB.getRawMany();

      return { data, total };
    } catch (e) {
      Logger.error('Unable to retrieve stream details', e);
      throw new HttpException(
        `Unable to retrieve stream details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getTopLivestreams(): Promise<{ data: Pick<Stream, "id" | "name" | "viewerCount" | "creator"> & { pfp: string }[]; }> {
    try {
      const streamQB = this.streamsRepository
        .createQueryBuilder('s')
        .innerJoinAndSelect('s.creator', 'creator')
        .where('s.status = :status', { status: StreamStatus.LIVE })
        .andWhere('s.type = :type', {
          type: StreamEventType.STREAM
        })
        .orderBy('s.viewerCount', 'DESC')
        .select('s.id', 'id')
        .addSelect('s.name', 'streamName')
        .addSelect('s.viewerCount', 'views')
        .addSelect('creator.profile_image_url', 'pfp')
        .addSelect('creator.username', 'creator')
        .limit(20);

      const data = await streamQB.getRawMany();

      return { data: data as Pick<Stream, "id" | "name" | "viewerCount" | "creator"> & { pfp: string }[] };
    } catch (e) {
      Logger.error('Unable to retrieve top live streams', e);
      throw new HttpException(
        `Unable to retrieve top live streams at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getTopPromotedBets(): Promise<any> {
    try {
      const betRoundsQB = this.bettingRoundRepository
        .createQueryBuilder('br')
        .where("br.status IN (:...statuses)", {
          statuses: [BettingRoundStatus.OPEN]
        })
        .leftJoinAndSelect("br.stream", "s")
        .leftJoinAndSelect("s.creator", "c")
        .andWhere("s.status = :status", {
          status: StreamStatus.SCHEDULED
        })
        .orderBy("s.scheduledStartTime", "ASC")
        .limit(10);

      const data = await betRoundsQB.getRawMany();
      const resultList = [];

      for (let i = 0; i < data.length; i++) {
        const item = data[i];

        const variables = await this.bettingVariableRepository
          .createQueryBuilder("bv")
          .where("bv.roundId = :roundId", {
            roundId: item.br_id
          })
          .getRawMany();

        let totalVotes = 0;
        let totalStreamCoins = 0;
        let totalGoldCoins = 0;

        variables.forEach((bv) => {
          totalVotes += Number(bv.bv_bet_count_gold_coin) + Number(bv.bv_bet_count_sweep_coin)

          totalStreamCoins += Number(bv.bv_total_bets_sweep_coin_amount)
          totalGoldCoins += Number(bv.bv_total_bets_gold_coin_amount)
        });

        const options = variables.map((v) => {
          const optionTotalVotes = Number(v.bv_bet_count_gold_coin) + Number(v.bv_bet_count_sweep_coin);

          return {
            option: v.bv_name,
            percentage: totalVotes > 0 ? (optionTotalVotes / totalVotes * 100).toFixed(2) : 0
          }
        });

        const itemData = {
          streamId: item.s_id,
          thumbnail: item.s_thumbnailUrl ?? "",
          creator: item.c_username,
          streamName: item.s_name,
          name: item.br_roundName,
          type: item.s_type,
          options: options.sort((a, b) => Number(b.percentage) - Number(a.percentage)),
          totalPot: {
            streamCoins: totalStreamCoins,
            goldCoins: totalGoldCoins
          }
        }

        resultList.push(itemData);
      }

      return {
        data: resultList
      }
    } catch (e) {
      console.log(e);

      Logger.error('Unable to retrieve top live streams', e);
      throw new HttpException(
        `Unable to retrieve top live streams at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async simplifyStreamResponse(
    streamData: any,
    bettingRoundStatus: string,
    betStat: any,
  ) {
    if (!streamData) return null;

    const {
      id,
      name,
      description,
      createdAt,
      updatedAt,
      embeddedUrl,
      thumbnailUrl,
      platformName,
      status,
      scheduledStartTime,
      actualStartTime,
      endTime,
      viewerCount,
      creatorId,
      bettingRounds = [],
      type
    } = streamData;

    return {
      streamId: id,
      streamName: name,
      streamType: type,
      description,
      createdAt,
      updatedAt,
      embeddedUrl,
      thumbnailUrl,
      platformName,
      status,
      scheduledStartTime,
      actualStartTime,
      endTime,
      viewerCount,
      creatorId,
      bettingRoundStatus,
      ...(betStat || {}),
      rounds: (bettingRounds ?? [])
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )
        .map((round: any) => ({
          roundId: round.id,
          roundName: round.roundName ?? '',
          createdAt: round.createdAt ?? '',
          options: (round.bettingVariables ?? []).map((variable: any) => ({
            id: variable.id,
            option: variable.name,
          })),
        })),
    };
  }

  /**
   * Retrieves a paginated and filtered list of streams for the admin view.
   * Supports optional text search, status-based filtering, sorting, and pagination.
   *
   * @param streamFilterDto - DTO containing optional filters such as query string (q),
   *                          stream status, sorting, and pagination range.
   *
   * @returns A Promise resolving to an object containing:
   *          - data: An array of streams with selected fields (id, name, status, viewerCount).
   *          - total: Total number of streams matching the filter criteria.
   * @author Reshma M S
   */
  async allStreamsForAdmin(
    streamFilterDto: StreamFilterDto,
  ): Promise<{ data: Stream[]; total: number }> {
    try {
      console.log(streamFilterDto);

      const sort: Sort = streamFilterDto.sort
        ? (JSON.parse(streamFilterDto.sort) as Sort)
        : undefined;

      const filter: FilterDto = streamFilterDto.filter
        ? (JSON.parse(streamFilterDto.filter) as FilterDto)
        : undefined;
      const range: Range = streamFilterDto.range
        ? (JSON.parse(streamFilterDto.range) as Range)
        : [0, 10];
      const { pagination = true, type } = streamFilterDto;
      const { streamStatus } = filter;

      const streamQB = this.streamsRepository
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.bettingRounds', 'r');
      if (filter?.q) {
        streamQB.andWhere(`(LOWER(s.name) ILIKE LOWER(:q) )`, {
          q: `%${filter.q}%`,
        });
      }

      if (type) {
        streamQB.andWhere(`s.type = :type`, {
          type,
        });
      }

      if (streamStatus) {
        streamQB.andWhere(`s.status = :streamStatus`, {
          streamStatus,
        });
      } else {
        streamQB.andWhere(`s.status != :streamStatus`, {
          streamStatus: StreamStatus.DELETED,
        });

        streamQB.andWhere(`s.status != :streamStatus`, {
          streamStatus: StreamStatus.ENDED,
        });
      }

      streamQB
        .select('s.id', 'id')
        .addSelect('s.name', 'streamName')
        .addSelect('s.status', 'streamStatus')
        .addSelect('s.viewerCount', 'viewerCount')
        .addSelect('creator.username', 'creator')
        .addSelect(
          `CASE
  WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.OPEN}' THEN 1 END) > 0
    THEN '${BettingRoundStatus.OPEN}'

  WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.LOCKED}' THEN 1 END) > 0
    AND COUNT(CASE WHEN r.status = '${BettingRoundStatus.OPEN}' THEN 1 END) = 0
    THEN '${BettingRoundStatus.LOCKED}'

  WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.CREATED}' THEN 1 END) > 0
    AND COUNT(CASE WHEN r.status IN ('${BettingRoundStatus.OPEN}', '${BettingRoundStatus.LOCKED}') THEN 1 END) = 0
    THEN '${BettingRoundStatus.CREATED}'

  WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.CLOSED}' THEN 1 END) > 0
    AND COUNT(CASE WHEN r.status IN ('${BettingRoundStatus.OPEN}', '${BettingRoundStatus.LOCKED}', '${BettingRoundStatus.CREATED}') THEN 1 END) = 0
    THEN '${BettingRoundStatus.CLOSED}'

  WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.CANCELLED}' THEN 1 END) > 0
    AND COUNT(CASE WHEN r.status IN ('${BettingRoundStatus.OPEN}', '${BettingRoundStatus.LOCKED}', '${BettingRoundStatus.CREATED}', '${BettingRoundStatus.CLOSED}') THEN 1 END) = 0
    THEN '${BettingRoundStatus.CANCELLED}'

  ELSE '${BettingRoundStatus.NO_BET_ROUND}' 
END
          `,
          'bettingRoundStatus',
        )
        .addSelect(
          `(SELECT COUNT(DISTINCT bet."user_id")
    FROM bets bet
    WHERE bet."stream_id" = s.id
      AND bet.status NOT IN ('${BetStatus.Refunded}', '${BetStatus.Cancelled}', '${BetStatus.Pending}')
  )`,
          'userBetCount',
        )
        .leftJoin(User, 'creator', 's.creatorId = creator.id')
        .addOrderBy(
          `CASE s.status
              WHEN 'live' THEN 1
              WHEN 'scheduled' THEN 2
              WHEN 'active' THEN 3
              WHEN 'ended' THEN 4
              WHEN 'cancelled' THEN 5
              WHEN 'deleted' THEN 6
              ELSE 7
          END`,
          'ASC',
        )

        .groupBy('s.id, creator.id');

      const total = await streamQB.getCount();
      if (pagination && range) {
        const [offset, limit] = range;
        streamQB.offset(offset).limit(limit);
      }
      const data = await streamQB.getRawMany();
      return { data, total };
    } catch (e) {
      this.logger.log(e);

      Logger.error(e);
      throw new HttpException(
        `Unable to retrieve stream details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Finds a stream by its ID and retrieves detailed information including betting rounds,
   * betting variables, bets, and user details. The function ensures:
   *   - Only streams with status LIVE, SCHEDULED, or ENDED are considered.
   *   - Betting rounds are sorted by `createdAt` in ascending order.
   *   - Only the first occurrence of a round with status "created" is kept,
   *     subsequent "created" rounds are removed.
   *   - For each round, the winning betting options and corresponding winners are returned.
   *
   * @param streamId - The unique identifier of the stream to retrieve.
   * @returns A structured object containing stream details, round details, and winners.
   * @throws NotFoundException - If no active stream with the given ID is found.
   * @throws HttpException (500) - If any other unexpected error occurs while retrieving the stream.
   * @author: Reshma M S
   */
  async findStreamById(streamId: string): Promise<StreamDetailsDto> {
    try {
      // Query the stream with relations: bettingRounds -> bettingVariables -> bets -> user
      const stream = await this.streamsRepository
        .createQueryBuilder('stream')
        .leftJoinAndSelect('stream.creator', 'users')
        .leftJoinAndSelect('stream.bettingRounds', 'br')
        .leftJoinAndSelect('br.bettingVariables', 'bv')
        .leftJoinAndSelect('bv.bets', 'b')
        .leftJoinAndSelect('b.user', 'u')
        .where('stream.id = :streamId', { streamId })
        .andWhere('stream.status IN (:...statuses)', {
          statuses: [
            StreamStatus.LIVE,
            StreamStatus.SCHEDULED,
            StreamStatus.ENDED,
          ],
        })
        .getOne();

      // If no valid stream is found, throw a NotFoundException
      if (!stream) {
        throw new NotFoundException(
          `Could not find an active stream with the specified ID. Please check the ID and try again.`,
        );
      }

      let rounds = [];
      if (stream.bettingRounds && stream.bettingRounds.length > 0) {
        let createdFound = false;

        // Sort rounds by createdAt ASC, remove duplicate "created" rounds,
        // and transform into the desired response format
        rounds = stream.bettingRounds
          .sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          )
          .filter((round) => {
            if (round.status === BettingRoundStatus.CREATED) {
              if (!createdFound) {
                createdFound = true; // keep only the first "created"
                return true;
              }
              return false; // skip subsequent "created"
            }
            return true; // keep other statuses
          })
          .map((round) => {
            // Calculate sum of totalBetsGoldCoinAmount for non-winning options
            const nonWinningGoldCoinSum = (round.bettingVariables ?? [])
              .filter((variable) => variable.is_winning_option === false)
              .reduce(
                (sum, variable) =>
                  Number(sum) + (Number(variable.totalBetsGoldCoinAmount) || 0),
                0,
              );

            return {
              roundName: round.roundName,
              roundStatus: round.status,
              createdAt: new Date(round.createdAt).toISOString(),
              winningOption: (round.bettingVariables ?? [])
                .filter((variable) => variable.is_winning_option === true)
                .map((variable) => ({
                  variableName: variable.name,
                  totalSweepCoinAmt: variable.totalBetsSweepCoinAmount,
                  totalGoldCoinAmt: nonWinningGoldCoinSum,
                  winners: (variable.bets ?? [])
                    .filter((bet) => bet.status === BetStatus.Won && bet.user)
                    .map((bet) => ({
                      userName: bet.user.username,
                      userProfileUrl: bet.user.profileImageUrl ?? null,
                    })),
                })),
            };
          });
      }

      // Prepare the final structured response
      const streamDetails = {
        id: stream.id,
        name: stream.name,
        embeddedUrl: stream.embeddedUrl,
        thumbnailUrl: stream.thumbnailUrl,
        platformName: stream.platformName,
        status: stream.status,
        scheduledStartTime: stream.scheduledStartTime,
        description: stream.description, // typo in field kept as in entity
        viewerCount: stream.viewerCount,
        roundDetails: rounds || [],
        creatorId: stream.creatorId,
        creatorUsername: stream.creator?.username,
      };

      return streamDetails;
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw e; // rethrow expected error
      }

      // Log unexpected errors and throw 500
      Logger.error('Unable to retrieve stream details', e);
      throw new HttpException(e.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async findBetRoundDetailsByStreamId(streamId: string, userId: string) {
    try {
      let userBetGoldCoins: number;
      let userBetSweepCoin: number;
      let wallet: Wallet;
      const stream = await this.streamsRepository
        .createQueryBuilder('stream')
        .leftJoinAndSelect(
          'stream.bettingRounds',
          'round',
          'round.status IN (:...roundStatuses)',
        )
        .leftJoinAndSelect('round.bettingVariables', 'variable')
        .leftJoinAndSelect('variable.bets', 'b', 'b.userId = :userId')
        .where('stream.id = :streamId', { streamId })

        .setParameters({
          roundStatuses: [BettingRoundStatus.OPEN, BettingRoundStatus.LOCKED],
          userId,
        })
        .getOne();
      if (userId) {
        wallet = await this.walletService.walletDetailsByUserId(userId);
      }

      if (!stream) {
        throw new NotFoundException(
          `Could not find a live stream with the specified ID. Please check the ID and try again.`,
        );
      }
      const total = { goldCoinSum: 0, sweepCoinSum: 0 };

      if (stream?.bettingRounds) {
        const rounds = stream.bettingRounds;

        for (const round of rounds) {
          if (round.bettingVariables) {
            const roundTotals = round.bettingVariables.reduce(
              (acc, variable) => {
                acc.goldCoinSum += Number(
                  variable.totalBetsGoldCoinAmount || 0,
                );
                acc.sweepCoinSum += Number(
                  variable.totalBetsSweepCoinAmount || 0,
                );
                return acc;
              },
              { goldCoinSum: 0, sweepCoinSum: 0 },
            );
            total.goldCoinSum += roundTotals.goldCoinSum;
            total.sweepCoinSum += roundTotals.sweepCoinSum;
          }
        }
      }
      const {
        goldCoinSum: roundTotalBetsGoldCoinAmount,
        sweepCoinSum: roundTotalBetsSweepCoinAmount,
      } = total;
      stream.bettingRounds.forEach((round) => {
        //sort betting varirable,
        round.bettingVariables.sort((a, b) => {
          return (
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        });
        // userBetGoldCoins, userBetSweepCoin  passing through response
        round.bettingVariables.forEach((variable) => {
          if (variable.bets && variable.bets.length > 0) {
            variable.bets.forEach((bet) => {
              if (bet.status === BetStatus.Active) {
                if (bet.currency === CurrencyType.GOLD_COINS) {
                  userBetGoldCoins = bet.amount;
                } else {
                  userBetSweepCoin = bet.amount;
                }
              }
            });
            delete variable?.bets;
          }
        });
      });

      const result = {
        walletGoldCoin: wallet?.goldCoins || 0,
        walletSweepCoin: wallet?.sweepCoins || 0,
        userBetGoldCoins: userBetGoldCoins || 0,
        userBetSweepCoin: userBetSweepCoin || 0,
        roundTotalBetsGoldCoinAmount,
        roundTotalBetsSweepCoinAmount,
        ...stream,
      };
      return result;
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw e;
      }

      Logger.error('Unable to retrieve stream details', e);
      throw new HttpException(e.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async findStreamDetailsForAdmin(streamId: string) {
    const stream = await this.streamsRepository.findOne({
      where: { id: streamId },
      relations: ['bettingRounds', 'bettingRounds.bettingVariables'],
    });

    if (!stream) return null;

    // Compute bettingRoundStatus
    const status = stream.bettingRounds.map((br) => br.status);

    let bettingRoundStatus = BettingRoundStatus.NO_BET_ROUND;

    if (status.includes(BettingRoundStatus.OPEN)) {
      bettingRoundStatus = BettingRoundStatus.OPEN;
    } else if (status.includes(BettingRoundStatus.LOCKED)) {
      bettingRoundStatus = BettingRoundStatus.LOCKED;
    } else if (status.includes(BettingRoundStatus.CREATED)) {
      bettingRoundStatus = BettingRoundStatus.CREATED;
    } else if (status.includes(BettingRoundStatus.CLOSED)) {
      bettingRoundStatus = BettingRoundStatus.CLOSED;
    } else if (status.includes(BettingRoundStatus.CANCELLED)) {
      bettingRoundStatus = BettingRoundStatus.CANCELLED;
    }

    // Attach computed status
    const betStat = await this.bettingService.getBetStatsByStream(streamId);
    return await this.simplifyStreamResponse(
      stream,
      bettingRoundStatus,
      betStat || {},
    );
  }

  /**
   * Updates a stream with the provided data.
   * Throws a NotFoundException if no stream is found with the given ID.
   * Logs and throws an HttpException in case of any internal errors during update.
   *
   * @param id - The unique identifier of the stream to update.
   * @param updateStreamDto - DTO containing the fields to update.
   * @returns A Promise resolving to the updated stream.
   * @throws NotFoundException | HttpException
   * @author Assistant
   */
  async updateStream(
    id: string,
    updateStreamDto: UpdateStreamDto,
  ): Promise<Stream> {
    try {
      const stream = await this.streamsRepository.findOne({
        where: { id },
      });

      if (!stream) {
        throw new NotFoundException(`Stream with ID ${id} not found`);
      }
      const prevStatus = stream.status;
      // Update only the provided fields
      if (updateStreamDto.name !== undefined) {
        stream.name = updateStreamDto.name;
      }
      if (updateStreamDto.description !== undefined) {
        stream.description = updateStreamDto.description;
      }

      // Auto-detect platform from embeddedUrl if provided
      if (updateStreamDto.embeddedUrl !== undefined) {
        stream.embeddedUrl = updateStreamDto.embeddedUrl;
        const detectedPlatform = this.detectPlatformFromUrl(
          updateStreamDto.embeddedUrl,
        );
        if (detectedPlatform) {
          stream.platformName = detectedPlatform;
        }
      }

      if (updateStreamDto.thumbnailUrl !== undefined) {
        stream.thumbnailUrl = updateStreamDto.thumbnailUrl;
      }
      if (updateStreamDto.scheduledStartTime !== undefined) {
        stream.scheduledStartTime = new Date(
          updateStreamDto.scheduledStartTime,
        );
      }
      if (updateStreamDto.status !== undefined) {
        stream.status = updateStreamDto.status;

        // Handle status-specific time updates
        if (updateStreamDto.status === 'live' && !stream.actualStartTime) {
          stream.actualStartTime = new Date();
        } else if (updateStreamDto.status === 'ended' && !stream.endTime) {
          stream.endTime = new Date();
        }
      }

      const streamResponse = await this.streamsRepository.save(stream);

      // If the scheduled start time is updated, remove any existing job and reschedule if necessary
      if (updateStreamDto.scheduledStartTime !== undefined) {
        const job = await this.queueService.getJobById(STREAM_LIVE_QUEUE, id);
        if (job) {
          await job.remove();
        }
        if (streamResponse.status === StreamStatus.SCHEDULED) {
          this.scheduleStream(streamResponse.id, stream.scheduledStartTime);
        }
      }

      if (
        prevStatus !== StreamStatus.ENDED &&
        streamResponse.status === StreamStatus.ENDED
      ) {
        this.streamGateway.emitStreamListEvent(StreamList.StreamEnded);
      } else {
        this.streamGateway.emitStreamListEvent(StreamList.StreamUpdated);
      }
      if (
        prevStatus === StreamStatus.SCHEDULED &&
        streamResponse.status === StreamStatus.LIVE
      ) {
        this.streamGateway.emitScheduledStreamUpdatedToLive(streamResponse.id);
      }

      return streamResponse;
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw e;
      }

      Logger.error('Unable to update stream details', e);
      throw new HttpException(
        `Unable to update stream details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Ends a stream if all its rounds are either CLOSED or CANCELLED.
   * Throws an error if any round is not in a terminal state.
   * @param streamId - The ID of the stream to end.
   * @returns The updated stream entity.
   */
  async endStreamIfAllRoundsClosedOrCancelled(
    streamId: string,
  ): Promise<Stream> {
    // Fetch the stream with all its rounds
    const stream = await this.streamsRepository.findOne({
      where: { id: streamId },
      relations: ['bettingRounds'],
    });
    if (!stream) {
      throw new NotFoundException(`Stream with ID ${streamId} not found`);
    }
    // Check all rounds are CLOSED or CANCELLED
    const allRoundsTerminal = (stream.bettingRounds || []).some(
      (round) =>
        round.status === BettingRoundStatus.OPEN ||
        round.status === BettingRoundStatus.LOCKED,
    );
    if (allRoundsTerminal) {
      throw new BadRequestException(
        'Please end or cancel all active rounds before ending the stream',
      );
    }
    // Set stream status to ENDED
    stream.status = StreamStatus.ENDED;
    stream.endTime = new Date();
    const savedStream = await this.streamsRepository.save(stream);

    // Emit stream end socket event
    this.streamGateway.emitStreamEnd(streamId);

    return savedStream;
  }
  /**
   * Schedule a debounced update of the viewer count for a given stream.
   *
   * @param streamId - The unique identifier of the stream
   * @param count - The latest number of active viewers
   *
   * @remarks
   * - Uses a debounce mechanism to reduce excessive DB writes.
   * - The update is delayed by 2 seconds after the last change.
   * - If new updates come in before the timer finishes, the timer resets.
   */
  async updateViewerCount(streamId: string, count: number) {
    this.latestCounts.set(streamId, count);

    if (this.updateTimers.has(streamId)) {
      clearTimeout(this.updateTimers.get(streamId));
    }

    const timer = setTimeout(async () => {
      const latest = this.latestCounts.get(streamId);
      if (latest !== undefined) {
        try {
          await this.streamsRepository.update(streamId, {
            viewerCount: latest,
          });
        } catch (err) {
          Logger.error(
            ` Failed to update viewer count for stream ${streamId}`,
            err.stack,
          );
        }
        this.latestCounts.delete(streamId);
      }
      this.updateTimers.delete(streamId);
    }, 2000);

    this.updateTimers.set(streamId, timer);
  }
  // Add inside StreamService class
  private async flushViewerCounts(reason?: string): Promise<void> {
    try {
      Logger.log(
        `[viewerCount] Flushing pending updates (${reason ?? 'shutdown'})`,
      );

      // Stop timers to prevent post-flush writes
      for (const timer of this.updateTimers.values()) clearTimeout(timer);
      this.updateTimers.clear();

      const entries = Array.from(this.latestCounts.entries());
      this.latestCounts.clear();

      if (entries.length === 0) return;

      // Parameterized CASE WHEN
      const qb = this.streamsRepository.createQueryBuilder().update(Stream);

      const whenThens: string[] = [];
      entries.forEach(([id, count], i) => {
        whenThens.push(`WHEN :id${i} THEN :count${i}`);
        qb.setParameter(`id${i}`, id);
        qb.setParameter(`count${i}`, count);
      });

      qb.set({
        viewerCount: () => `CASE "id" ${whenThens.join(' ')} END`,
      }).where(`id IN (${entries.map((_, i) => `:id${i}`).join(', ')})`);

      await qb.execute();

      Logger.log(`[viewerCount] Flushed ${entries.length} viewer counts to DB`);
    } catch (err) {
      Logger.error('[viewerCount] Flush failed', err?.stack ?? String(err));
    }
  }

  /**
   * Flush any pending viewer count updates to DB before shutdown (batch update)
   */
  async onApplicationShutdown(signal?: string) {
    await this.flushViewerCounts(signal);
  }
  async updateStreamStatus(streamId: string) {
    try {
      const stream = await this.streamsRepository.findOne({
        where: { id: streamId },
        select: ['id', 'status', 'scheduledStartTime'],
      });

      if (!stream) {
        throw new NotFoundException(`Stream with ID ${streamId} not found`);
      }

      // Update status based on scheduled start time
      const prevStatus = stream.status;
      const currentTime = new Date();
      let changed = false;

      if (stream.status === StreamStatus.SCHEDULED) {
        if (
          stream.scheduledStartTime &&
          stream.scheduledStartTime <= currentTime
        ) {
          stream.status = StreamStatus.LIVE;
          stream.actualStartTime = currentTime;
          changed = true;
        }
      } else if (stream.status === StreamStatus.LIVE) {
        return stream;
      }

      if (!changed) return stream;

      await this.streamsRepository.update(
        { id: stream.id },
        { status: stream.status, actualStartTime: stream.actualStartTime },
      );
      const streamUpdated = await this.streamsRepository.findOne({
        where: { id: stream.id },
        select: ['id', 'status'],
      });
      this.streamGateway.emitStreamListEvent(StreamList.StreamUpdated);

      if (
        prevStatus === StreamStatus.SCHEDULED &&
        streamUpdated.status === StreamStatus.LIVE
      ) {
        this.streamGateway.emitScheduledStreamUpdatedToLive(streamUpdated.id);
      }
      return streamUpdated;
    } catch (error) {
      Logger.error(`Failed to update stream status for ${streamId}`, error);
      throw error;
    }
  }

  async scheduleStream(streamId: string, scheduledTime: Date | string) {
    const scheduledDate =
      scheduledTime instanceof Date ? scheduledTime : new Date(scheduledTime);
    this.queueService.addStreamLiveJob(streamId, scheduledDate);
  }

  /**
   * Retrieves the current viewer count for a stream.
   * @param streamId The ID of the stream.
   * @returns The current viewer count, or 0 if the stream doesn't exist.
   */
  async getViewerCount(streamId: string): Promise<number> {
    const stream = await this.streamsRepository.findOne({
      where: { id: streamId },
    });
    return stream ? stream.viewerCount : 0;
  }

  async getLiveStreamsCount(): Promise<number> {
    return this.streamsRepository.count({
      where: {
        status: StreamStatus.LIVE, // Only count live streams
      },
    });
  }

  private formatDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
      .toString()
      .padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60)
      .toString()
      .padStart(2, '0');
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  async getTotalLiveDuration(): Promise<string> {
    const result = await this.dataSource.query(`
      SELECT SUM(EXTRACT(EPOCH FROM ("endTime" - "scheduledStartTime"))) AS total_seconds
      FROM streams
      WHERE "scheduledStartTime" IS NOT NULL AND "endTime" IS NOT NULL
    `);

    const totalSeconds = parseFloat(result[0].total_seconds) || 0;
    return this.formatDuration(totalSeconds);
  }

  /**
   * Retrieves analytics summary for a specific stream.
   * Calculates the total stream time (from scheduledStartTime to endTime, or current time if not ended).
   * Formats the duration as "HHh MMm SSs".
   *
   * @param streamId - The ID of the stream to summarize
   * @returns An object containing:
   *    - totalUsers: (currently uses viewerCount as a placeholder for unique users)
   *    - totalStreamTime: formatted duration string
   */
  async getStreamAnalytics(streamId: string): Promise<any> {
    // Fetch stream details for the given streamId
    const stream = await this.findStreamDetailsForAdmin(streamId);

    // Calculate total stream time in seconds
    const scheduledStart = stream.scheduledStartTime
      ? new Date(stream.scheduledStartTime)
      : null;
    // Use endTime if available, otherwise use current time
    const end = stream.endTime ? new Date(stream.endTime) : new Date();

    let totalSeconds = 0;
    if (scheduledStart) {
      totalSeconds = Math.floor(
        (end.getTime() - scheduledStart.getTime()) / 1000,
      );
      if (totalSeconds < 0) totalSeconds = 0;
    }

    // Format the duration as "HHh MMm SSs"
    const totalStreamTime = this.formatDuration(totalSeconds);

    return {
      totalUsers: stream.viewerCount || 0, // Assuming viewerCount represents unique users
      totalStreamTime,
    };
  }
  /**
   * Cancels a scheduled stream and handles associated cleanup operations.
   *
   * This method performs the following actions:
   * 1. Retrieves the scheduled stream and its associated active betting rounds.
   * 2. Ensures the stream exists; throws an error if not found.
   * 3. Removes the stream from the scheduled processing queue.
   * 4. Updates the stream status to `CANCELED` in the database.
   * 5. If the stream has associated betting rounds, it cancels each round and processes refunds.
   *
   * @param streamId - The ID of the scheduled stream to cancel.
   * @returns A promise that resolves with the canceled stream's ID.
   * @throws BadRequestException - If the stream doesn't exist or is not in the queue.
   */
  async cancelScheduledStream(streamId: string): Promise<String> {
    try {
      //retun a sheduled stream with open or locked round. and with active bets
      const stream = await this.getScheduledStreamWithActiveRound(streamId);
      if (!stream) {
        throw new BadRequestException(
          `No scheduled stream found for stream ID: ${streamId}`,
        );
      }
      const isRemoved = await this.removeScheduledStreamFromQueue(streamId);
      if (!isRemoved) {
        throw new BadRequestException(
          `"Stream "${stream.name}" was not found in the queue. It may have already been processed or removed.`,
        );
      }
      await this.streamsRepository
        .createQueryBuilder()
        .update(Stream)
        .set({ status: StreamStatus.CANCELLED })
        .where('id = :streamId', { streamId })
        .returning('status')
        .execute();
      if (stream?.bettingRounds && stream.bettingRounds.length > 0) {
        for (const round of stream.bettingRounds) {
          await this.bettingService.cancelRoundAndRefund(round.id);
        }
      }
      return streamId;
    } catch (error) {
      Logger.error('Error in StreamService.cancelScheduledStream:', error);
      throw new BadRequestException((error as Error).message);
    }
  }
  /**
   * Delete a scheduled stream and handles associated cleanup operations.
   *
   * This method performs the following actions:
   * 1. Retrieves the scheduled stream and its associated active betting rounds.
   * 2. Ensures the stream exists; throws an error if not found.
   * 3. Removes the stream from the scheduled processing queue.
   * 4. Updates the stream status to `Delete` in the database.
   * 5. If the stream has associated betting rounds, it cancels each round and processes refunds.
   *
   * @param streamId - The ID of the scheduled stream to delete.
   * @returns A promise that resolves with the delete stream's ID.
   * @throws BadRequestException - If the stream doesn't exist or is not in the queue.
   */
  async deleteScheduledStream(streamId: string): Promise<String> {
    try {
      //retun a sheduled stream with created, open or locked round. and with active bets
      const stream = await this.getScheduledStreamWithActiveRound(streamId);
      if (!stream) {
        throw new BadRequestException(
          `No scheduled stream found for stream ID: ${streamId}`,
        );
      }
      const isRemoved = await this.removeScheduledStreamFromQueue(streamId);
      if (!isRemoved) {
        throw new BadRequestException(
          `"Stream "${stream.name}" was not found in the queue. It may have already been processed or removed.`,
        );
      }
      await this.streamsRepository
        .createQueryBuilder()
        .update(Stream)
        .set({ status: StreamStatus.DELETED })
        .where('id = :streamId', { streamId })
        .returning('status')
        .execute();
      if (stream?.bettingRounds && stream.bettingRounds.length > 0) {
        for (const round of stream.bettingRounds) {
          await this.bettingService.cancelRoundAndRefund(round.id);
        }
      }

      // Emit stream list event to update the UI
      this.streamGateway.emitStreamListEvent(StreamList.StreamDeleted);

      return streamId;
    } catch (error) {
      Logger.error('Error in StreamService.deleteScheduledStream:', error);
      throw new BadRequestException((error as Error).message);
    }
  }
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
  /**
   * Removes a scheduled stream job from the queue based on the given stream ID.
   *
   * @param streamId - The unique identifier of the stream/job to be removed from the queue.
   * @returns A boolean indicating whether the job was found and successfully removed.
   */
  async removeScheduledStreamFromQueue(streamId: string): Promise<Boolean> {
    const job = await this.queueService.getJobById(STREAM_LIVE_QUEUE, streamId);
    if (job) {
      await job.remove();
      return true;
    }
    return false;
  }
  /**
   * Retrieves a scheduled stream by its ID along with its associated betting rounds and active bets.
   *
   * - Only betting rounds with status `OPEN`, CREATED or `LOCKED` are included.
   * - Only bets with status `ACTIVE` within those betting rounds are returned.
   * - Limits the selected fields to essential data for optimized performance.
   *
   * @param streamId - The unique identifier of the stream to fetch.
   * @returns A stream entity with filtered betting rounds and active bets, or `null` if not found.
   */
  async getScheduledStreamWithActiveRound(streamId: string) {
    return await this.streamsRepository
      .createQueryBuilder('stream')
      .leftJoinAndSelect(
        'stream.bettingRounds',
        'bettingRound',
        'bettingRound.status IN (:...roundStatuses)',
        {
          roundStatuses: [
            BettingRoundStatus.OPEN,
            BettingRoundStatus.LOCKED,
            BettingRoundStatus.CREATED,
          ],
        },
      )
      .leftJoinAndSelect('bettingRound.bet', 'bet', 'bet.status = :betStatus', {
        betStatus: BetStatus.Active,
      })
      .where('stream.id = :streamId', { streamId })
      .andWhere('stream.status = :status', { status: StreamStatus.SCHEDULED })
      .select([
        'stream.id',
        'stream.name',
        'stream.status',
        'bettingRound.id',
        'bettingRound.status',
        'bet.id',
        'bet.status',
      ])
      .getOne();
  }

  /**
   * Retrieves a paginated list of live and scheduled streams for the home page view.
   * Ensures DELETED, CANCELLED  and ENDEDstreams are excluded.
  
   * Ordering logic:
   * - Live streams appear first, ordered by createdAt in descending order.
   * - Scheduled streams appear next, ordered by scheduledStartTime in ascending order.
   *
   * Selects essential fields  along with
   * derived values:
   * - bettingRoundStatus (calculated from related betting rounds)   *
   * Applies pagination with a default range of [0, 24] if not specified.
   * Returns both the filtered data and the total count of matching streams.
   * Logs errors and throws an HttpException in case of failures.
   *
   * @param liveScheduledStreamListDto - DTO containing optional sort and range for pagination.
   * @returns A Promise resolving to an object with:
   *          - data: Array of stream records with selected and derived fields.
   *          - total: Total number of matching stream records.
   * @throws HttpException - If an error occurs during query execution.
   * @author Reshma M S
   */

  async getScheduledAndLiveStreams(
    liveScheduledStreamListDto: LiveScheduledStreamListDto,
  ): Promise<{ data: Stream[]; total: number }> {
    try {
      const range: Range = liveScheduledStreamListDto.range
        ? (JSON.parse(liveScheduledStreamListDto.range) as Range)
        : [0, 24];

      const { pagination = true } = liveScheduledStreamListDto;

      const streamQB = this.streamsRepository
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.bettingRounds', 'r')
        .leftJoinAndSelect('r.bettingVariables', 'bv')
        .andWhere(`s.status = :scheduled or s.status = :live`, {
          scheduled: StreamStatus.SCHEDULED,
          live: StreamStatus.LIVE,
        });


      if (liveScheduledStreamListDto.username) {
        streamQB
          .innerJoinAndSelect('s.creator', 'creator', 'creator.username = :username')
          .setParameter('username', liveScheduledStreamListDto.username);
      } else {
        streamQB.leftJoinAndSelect('s.creator', 'creator');
      }

      /** Custom ordering:
       *  - LIVE streams first (createdAt DESC)
       *  - SCHEDULED streams next (scheduledStartTime ASC)
       *  - Fallback to user-defined sort if provided
       */

      streamQB
        .orderBy(
          `CASE 
        WHEN s.status = :live THEN 1
        WHEN s.status = :scheduled THEN 2
        ELSE 3
      END`,
          'ASC',
        )
        .addOrderBy(
          `CASE 
        WHEN s.status = :live THEN s."createdAt"
      END`,
          'DESC',
          'NULLS LAST',
        )
        .addOrderBy(
          `CASE 
        WHEN s.status = :scheduled THEN s."scheduledStartTime"
      END`,
          'ASC',
          'NULLS LAST',
        )
        .setParameters({
          live: StreamStatus.LIVE,
          scheduled: StreamStatus.SCHEDULED,
        });

      /** Select fields + betting round status calculation */
      streamQB
        .select('s.id', 'id')
        .addSelect('s.name', 'streamName')
        .addSelect('s.status', 'streamStatus')
        .addSelect('s.thumbnailUrl', 'thumbnailUrl')
        .addSelect('s.scheduledStartTime', 'scheduledStartTime')
        .addSelect('creator.username', 'creatorUsername')
        .addSelect(
          'COALESCE(SUM(bv.total_bets_gold_coin_amount), 0)',
          'totalBetsGoldCoinAmount',
        )
        .addSelect(
          'COALESCE(SUM(bv.total_bets_sweep_coin_amount), 0)',
          'totalBetsSweepCoinAmount',
        )
        .addSelect(
          `CASE
        WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.OPEN}' THEN 1 END) > 0
          THEN '${BettingRoundStatus.OPEN}'

        WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.LOCKED}' THEN 1 END) > 0
          AND COUNT(CASE WHEN r.status = '${BettingRoundStatus.OPEN}' THEN 1 END) = 0
          THEN '${BettingRoundStatus.LOCKED}'

        WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.CREATED}' THEN 1 END) > 0
          AND COUNT(CASE WHEN r.status IN ('${BettingRoundStatus.OPEN}', '${BettingRoundStatus.LOCKED}') THEN 1 END) = 0
          THEN '${BettingRoundStatus.CREATED}'

        WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.CLOSED}' THEN 1 END) > 0
          AND COUNT(CASE WHEN r.status IN ('${BettingRoundStatus.OPEN}', '${BettingRoundStatus.LOCKED}', '${BettingRoundStatus.CREATED}') THEN 1 END) = 0
          THEN '${BettingRoundStatus.CLOSED}'

        WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.CANCELLED}' THEN 1 END) > 0
          AND COUNT(CASE WHEN r.status IN ('${BettingRoundStatus.OPEN}', '${BettingRoundStatus.LOCKED}', '${BettingRoundStatus.CREATED}', '${BettingRoundStatus.CLOSED}') THEN 1 END) = 0
          THEN '${BettingRoundStatus.CANCELLED}'

        ELSE '${BettingRoundStatus.NO_BET_ROUND}'
      END`,
          'bettingRoundStatus',
        )
        .addSelect(
          `(SELECT COUNT(DISTINCT bet."user_id")
        FROM bets bet
        WHERE bet."stream_id" = s.id
          AND bet.status NOT IN ('${BetStatus.Refunded}', '${BetStatus.Cancelled}', '${BetStatus.Pending}')
      )`,
          'userBetCount',
        )
        .groupBy('s.id, creator.username');

      /**  Total count */
      const total = await streamQB.getCount();

      /**  Pagination */
      if (pagination && range) {
        const [offset, limit] = range;
        streamQB.offset(offset).limit(limit);
      }

      const data = await streamQB.getRawMany();

      return { data, total };
    } catch (e) {
      Logger.error('Unable to retrieve stream details', e);
      throw new HttpException(
        `Unable to retrieve stream details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getDisplayBets(
    homepageBetListDto: HomepageBetListDto,
  ): Promise<any> {

    const page = homepageBetListDto.page ?? 1;
    const take = 24;
    const offset = (page - 1) * take;

    try {
      const betRoundsQB = this.bettingRoundRepository
        .createQueryBuilder('br')
        .where("br.status IN (:...statuses)", {
          statuses: [BettingRoundStatus.OPEN]
        })
        .leftJoinAndSelect("br.stream", "s")
        .leftJoinAndSelect("s.creator", "c")
        .andWhere("s.status IN (:...streamStatuses)", {
          streamStatuses: [
            StreamStatus.LIVE,
            StreamStatus.SCHEDULED
          ]
        })
        .limit(take)
        .offset(offset);

      const count = await this.bettingRoundRepository
        .createQueryBuilder('br')
        .where("br.status IN (:...statuses)", {
          statuses: [BettingRoundStatus.OPEN]
        })
        .leftJoinAndSelect("br.stream", "s")
        .andWhere("s.status = :status", {
          status: StreamStatus.LIVE
        })
        .getCount()

      const hasNextPage = count > (offset + take);

      const data = await betRoundsQB.getRawMany();
      const resultList = [];

      for (let i = 0; i < data.length; i++) {
        const item = data[i];

        const variables = await this.bettingVariableRepository
          .createQueryBuilder("bv")
          .where("bv.roundId = :roundId", {
            roundId: item.br_id
          })
          .getRawMany();

        let totalVotes = 0;
        let totalStreamCoins = 0;
        let totalGoldCoins = 0;

        variables.forEach((bv) => {
          totalVotes += Number(bv.bv_bet_count_gold_coin) + Number(bv.bv_bet_count_sweep_coin)

          totalStreamCoins += Number(bv.bv_total_bets_sweep_coin_amount)
          totalGoldCoins += Number(bv.bv_total_bets_gold_coin_amount)
        });

        const options = variables.map((v) => {
          const optionTotalVotes = Number(v.bv_bet_count_gold_coin) + Number(v.bv_bet_count_sweep_coin);

          return {
            option: v.bv_name,
            percentage: totalVotes > 0 ? (optionTotalVotes / totalVotes * 100).toFixed(2) : 0
          }
        });

        const itemData = {
          streamId: item.s_id,
          thumbnail: item.s_thumbnailUrl ?? "",
          creator: item.c_username,
          streamName: item.s_name,
          name: item.br_roundName,
          type: item.s_type,
          options: options.sort((a, b) => Number(b.percentage) - Number(a.percentage)),
          totalPot: {
            streamCoins: totalStreamCoins,
            goldCoins: totalGoldCoins
          }
        }

        resultList.push(itemData);
      }

      return {
        data: {
          data: resultList,
          page,
          hasNextPage
        }
      }
    } catch (e) {
      console.log(e);

      Logger.error('Unable to retrieve stream details', e);
      throw new HttpException(
        `Unable to retrieve stream details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getUpcomingBets(
    homepageBetListDto: HomepageBetListDto,
  ): Promise<any> {

    const page = homepageBetListDto.page ?? 1;
    const take = 15;
    const offset = (page - 1) * take;

    try {
      const betRoundsQB = this.bettingRoundRepository
        .createQueryBuilder('br')
        .where("br.status IN (:...statuses)", {
          statuses: [BettingRoundStatus.OPEN]
        })
        .leftJoinAndSelect("br.stream", "s")
        .leftJoinAndSelect("s.creator", "c")
        .andWhere("s.status = :status", {
          status: StreamStatus.SCHEDULED
        })
        .limit(take)
        .offset(offset);

      const count = await this.bettingRoundRepository
        .createQueryBuilder('br')
        .where("br.status IN (:...statuses)", {
          statuses: [BettingRoundStatus.OPEN]
        })
        .leftJoinAndSelect("br.stream", "s")
        .andWhere("s.status = :status", {
          status: StreamStatus.SCHEDULED
        })
        .getCount()

      const hasNextPage = count > (offset + take);

      const data = await betRoundsQB.getRawMany();
      const resultList = [];

      for (let i = 0; i < data.length; i++) {
        const item = data[i];

        const variables = await this.bettingVariableRepository
          .createQueryBuilder("bv")
          .where("bv.roundId = :roundId", {
            roundId: item.br_id
          })
          .getRawMany();

        let totalVotes = 0;
        let totalStreamCoins = 0;
        let totalGoldCoins = 0;

        variables.forEach((bv) => {
          totalVotes += Number(bv.bv_bet_count_gold_coin) + Number(bv.bv_bet_count_sweep_coin)

          totalStreamCoins += Number(bv.bv_total_bets_sweep_coin_amount)
          totalGoldCoins += Number(bv.bv_total_bets_gold_coin_amount)
        });

        const options = variables.map((v) => {
          const optionTotalVotes = Number(v.bv_bet_count_gold_coin) + Number(v.bv_bet_count_sweep_coin);

          return {
            option: v.bv_name,
            percentage: totalVotes > 0 ? (optionTotalVotes / totalVotes * 100).toFixed(2) : 0
          }
        });

        const itemData = {
          streamId: item.s_id,
          thumbnail: item.s_thumbnailUrl ?? "",
          creator: item.c_username,
          streamName: item.s_name,
          name: item.br_roundName,
          type: item.s_type,
          options: options.sort((a, b) => Number(b.percentage) - Number(a.percentage)),
          totalPot: {
            streamCoins: totalStreamCoins,
            goldCoins: totalGoldCoins
          }
        }

        resultList.push(itemData);
      }

      return {
        data: {
          data: resultList,
          page,
          hasNextPage
        }
      }
    } catch (e) {
      console.log(e);

      Logger.error('Unable to retrieve stream details', e);
      throw new HttpException(
        `Unable to retrieve stream details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}