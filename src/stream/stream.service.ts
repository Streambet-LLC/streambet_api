import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Stream, StreamStatus } from './entities/stream.entity';
import { StreamFilterDto } from './dto/list-stream.dto';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { UpdateStreamDto } from '../betting/dto/update-stream.dto';
import { WalletsService } from 'src/wallets/wallets.service';
import { Wallet } from 'src/wallets/entities/wallet.entity';
import { BettingRoundStatus } from 'src/enums/round-status.enum';
import { BettingGateway } from 'src/betting/betting.gateway';
import { Queue } from 'bullmq';
import redisConfig from 'src/config/redis.config';
import { BetStatus } from 'src/enums/bet-status.enum';
import { PlatformName } from 'src/enums/platform-name.enum';
import { CurrencyType } from 'src/wallets/entities/transaction.entity';

@Injectable()
export class StreamService {
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
    private walletService: WalletsService,
    @Inject(forwardRef(() => BettingGateway))
    private bettingGateway: BettingGateway,
    private dataSource: DataSource,
  ) {}

  private streamLiveQueue = new Queue(
    `${process.env.REDIS_KEY_PREFIX}_STREAM_LIVE`,
    { connection: redisConfig },
  );

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

      const { pagination = true, streamStatus } = streamFilterDto;

      const streamQB = this.streamsRepository.createQueryBuilder('s');

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

      streamQB
        .select('s.id', 'id')
        .addSelect('s.name', 'streamName')
        .addSelect('s.thumbnailUrl', 'thumbnailURL')
        .addSelect('s.scheduledStartTime', 'scheduledStartTime');
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
  private async simplifyStreamResponse(
    streamData: any,
    bettingRoundStatus: string,
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

      bettingRounds = [],
    } = streamData;

    return {
      streamId: id,
      streamName: name,
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
      bettingRoundStatus,
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
      const sort: Sort = streamFilterDto.sort
        ? (JSON.parse(streamFilterDto.sort) as Sort)
        : undefined;

      const filter: FilterDto = streamFilterDto.filter
        ? (JSON.parse(streamFilterDto.filter) as FilterDto)
        : undefined;
      const range: Range = streamFilterDto.range
        ? (JSON.parse(streamFilterDto.range) as Range)
        : [0, 10];
      const { pagination = true, streamStatus } = streamFilterDto;

      const streamQB = this.streamsRepository
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.bettingRounds', 'r');
      if (filter?.q) {
        streamQB.andWhere(`(LOWER(s.name) ILIKE LOWER(:q) )`, {
          q: `%${filter.q}%`,
        });
      }

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

      streamQB
        .select('s.id', 'id')
        .addSelect('s.name', 'streamName')
        .addSelect('s.status', 'streamStatus')
        .addSelect('s.viewerCount', 'viewerCount')
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

        .groupBy('s.id');

      const total = await streamQB.getCount();
      if (pagination && range) {
        const [offset, limit] = range;
        streamQB.offset(offset).limit(limit);
      }
      const data = await streamQB.getRawMany();
      return { data, total };
    } catch (e) {
      console.log(e);

      Logger.error(e);
      throw new HttpException(
        `Unable to retrieve stream details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Retrieves a stream by its ID with selected fields (id, kickEmbedUrl, name).
   * Throws a NotFoundException if no stream is found with the given ID.
   * Logs and throws an HttpException in case of any internal errors during retrieval.
   *
   * @param id - The unique identifier of the stream to retrieve.
   * @returns A Promise resolving to the stream details.
   * @throws NotFoundException | HttpException
   * @author Reshma M S
   */
  async findStreamById(id: string): Promise<Stream> {
    try {
      const stream = await this.streamsRepository.findOne({
        where: {
          id,
          status: In([StreamStatus.LIVE, StreamStatus.SCHEDULED]), // Include both LIVE and SCHEDULED
        },
        select: {
          id: true,
          embeddedUrl: true,
          name: true,
          platformName: true,
          status: true,
          scheduledStartTime: true,
          thumbnailUrl: true,
        },
      });

      if (!stream) {
        throw new NotFoundException(
          `Could not find an active stream with the specified ID. Please check the ID and try again.`,
        );
      }
      return stream;
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw e;
      }

      Logger.error('Unable to retrieve stream details', e);
      throw new HttpException(e.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async findBetRoundDetailsByStreamId(streamId: string, userId: string) {
    try {
      let userBetFreeTokens: number;
      let userBetStreamCoin: number;
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
      const total = { tokenSum: 0, coinSum: 0 };

      if (stream?.bettingRounds) {
        const rounds = stream.bettingRounds;

        for (const round of rounds) {
          if (round.bettingVariables) {
            const roundTotals = round.bettingVariables.reduce(
              (acc, variable) => {
                acc.tokenSum += Number(variable.totalBetsTokenAmount || 0);
                acc.coinSum += Number(variable.totalBetsCoinAmount || 0);
                return acc;
              },
              { tokenSum: 0, coinSum: 0 },
            );
            total.tokenSum += roundTotals.tokenSum;
            total.coinSum += roundTotals.coinSum;
          }
        }
      }
      const {
        tokenSum: roundTotalBetsTokenAmount,
        coinSum: roundTotalBetsCoinAmount,
      } = total;
      stream.bettingRounds.forEach((round) => {
        //sort betting varirable,
        round.bettingVariables.sort((a, b) => {
          return (
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        });
        // userBetFreeTokens, userBetStreamCoin  passing through response
        round.bettingVariables.forEach((variable) => {
          if (variable.bets.length > 0) {
            variable.bets.forEach((bet) => {
              if (bet.currency === CurrencyType.FREE_TOKENS) {
                userBetFreeTokens = bet.amount;
              } else {
                userBetStreamCoin = bet.amount;
              }
              // Excluded 'bets' from the response payload to reduce unnecessary data.
              delete variable.bets;
            });
          } else {
            // Excluded 'bets [] from the response payload to reduce unnecessary data.
            delete variable.bets;
          }
        });
      });
      console.log(userBetFreeTokens, userBetStreamCoin, 'dd');

      const result = {
        walletFreeToken: wallet?.freeTokens || 0,
        walletCoin: wallet?.streamCoins || 0,
        userBetFreeTokens: userBetFreeTokens || 0,
        userBetStreamCoin: userBetStreamCoin || 0,
        roundTotalBetsTokenAmount,
        roundTotalBetsCoinAmount,
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
  async findStreamDetailsForAdmin(id: string) {
    const stream = await this.streamsRepository.findOne({
      where: { id },
      relations: ['bettingRounds', 'bettingRounds.bettingVariables'],
    });

    if (!stream) return null;

    // Compute bettingRoundStatus
    const statuses = stream.bettingRounds.map((br) => br.status);

    let bettingRoundStatus = BettingRoundStatus.NO_BET_ROUND;

    if (statuses.includes(BettingRoundStatus.OPEN)) {
      bettingRoundStatus = BettingRoundStatus.OPEN;
    } else if (statuses.includes(BettingRoundStatus.LOCKED)) {
      bettingRoundStatus = BettingRoundStatus.LOCKED;
    } else if (statuses.includes(BettingRoundStatus.CREATED)) {
      bettingRoundStatus = BettingRoundStatus.CREATED;
    } else if (statuses.includes(BettingRoundStatus.CLOSED)) {
      bettingRoundStatus = BettingRoundStatus.CLOSED;
    } else if (statuses.includes(BettingRoundStatus.CANCELLED)) {
      bettingRoundStatus = BettingRoundStatus.CANCELLED;
    }

    // Attach computed status

    return await this.simplifyStreamResponse(stream, bettingRoundStatus);
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
        const job = await this.streamLiveQueue.getJob(id);
        if (job) {
          await job.remove();
        }
        if (streamResponse.status === StreamStatus.SCHEDULED) {
          this.scheduleStream(streamResponse.id, stream.scheduledStartTime);
        }
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
    this.bettingGateway.emitStreamEnd(streamId);

    return savedStream;
  }
  /**
   * Decrements the viewer count for a given stream ID in the database.
   * Ensures the count does not go below zero.
   * @param streamId The ID of the stream.
   * @returns The updated viewer count.
   */
  async decrementViewerCount(streamId: string): Promise<number> {
    const result = await this.streamsRepository
      .createQueryBuilder()
      .update(Stream)
      .set({ viewerCount: () => 'GREATEST(0, "viewerCount" - 1)' })
      .where('id = :streamId', { streamId })
      .returning('viewerCount')
      .execute();

    if (result.affected === 0) {
      throw new NotFoundException(`Stream with ID ${streamId} not found`);
    }
    const updatedCount = result.raw[0].viewerCount;

    Logger.log(`Stream ${streamId}: Viewers decremented to ${updatedCount}`);
    return updatedCount;
  }
  /**
   * Increments the viewer count for a given stream ID in the database.
   * @param streamId The ID of the stream.
   * @returns The updated viewer count.
   */
  async incrementViewerCount(streamId: string): Promise<number> {
    const stream = await this.streamsRepository.findOne({
      where: { id: streamId },
    });
    stream.viewerCount++;
    await this.streamsRepository.save(stream);
    Logger.log(
      `Stream ${streamId}: Viewers incremented to ${stream.viewerCount}`,
    );
    return stream.viewerCount;
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
      const currentTime = new Date();
      if (stream.status === StreamStatus.SCHEDULED) {
        if (stream.scheduledStartTime <= currentTime) {
          stream.status = StreamStatus.LIVE;
          stream.actualStartTime = currentTime;
        }
      } else if (stream.status === StreamStatus.LIVE) {
        return stream;
      }

      return await this.streamsRepository.save(stream);
    } catch (error) {
      Logger.error(`Failed to update stream status for ${streamId}`, error);
      throw error;
    }
  }

  async scheduleStream(streamId: string, scheduledTime: Date | string) {
    const scheduledDate =
      scheduledTime instanceof Date ? scheduledTime : new Date(scheduledTime);
    const delay = scheduledDate.getTime() - Date.now();
    Logger.log(
      `Scheduling stream ${streamId} for ${scheduledDate}`,
      'StreamLiveWorker',
    );
    await this.streamLiveQueue.add(
      'make-live',
      { streamId },
      {
        delay: Math.max(delay, 0),
        jobId: streamId,
      },
    );
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
}
