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
import { Repository } from 'typeorm';
import { Stream, StreamStatus } from './entities/stream.entity';
import { StreamFilterDto } from './dto/list-stream.dto';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { UpdateStreamDto } from '../betting/dto/update-stream.dto';
import { WalletsService } from 'src/wallets/wallets.service';
import { Wallet } from 'src/wallets/entities/wallet.entity';
import { BettingRoundStatus } from 'src/enums/round-status.enum';
import { BettingGateway } from 'src/betting/betting.gateway';

@Injectable()
export class StreamService {
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
    private walletService: WalletsService,
    @Inject(forwardRef(() => BettingGateway))
    private bettingGateway: BettingGateway,
  ) {}
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
  private async simplifyStreamResponse(streamData: any) {
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
      rounds: bettingRounds.map((round: any) => ({
        roundId: round.id,
        roundName: round.roundName ?? '',
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
          `
          CASE
            WHEN COUNT(r.id) > 0 AND COUNT(CASE WHEN r.status = '${BettingRoundStatus.CANCELLED}' THEN 1 END) = COUNT(r.id) THEN '${BettingRoundStatus.CANCELLED}'
            WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.CLOSED}' THEN 1 END) > 0 THEN '${BettingRoundStatus.CLOSED}'
            WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.OPEN}' THEN 1 END) > 0 THEN '${BettingRoundStatus.OPEN}'
            WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.LOCKED}' THEN 1 END) > 0 THEN '${BettingRoundStatus.LOCKED}'
            WHEN COUNT(CASE WHEN r.status = '${BettingRoundStatus.CREATED}' THEN 1 END) > 0 THEN '${BettingRoundStatus.CREATED}'
            ELSE 'no bet round'
          END
          `,
          'bettingRoundStatus',
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
        where: { id, status: StreamStatus.LIVE },
        select: {
          id: true,
          embeddedUrl: true,
          name: true,
          platformName: true,
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
      let wallet: Wallet;
      const stream = await this.streamsRepository
        .createQueryBuilder('stream')
        .leftJoinAndSelect(
          'stream.bettingRounds',
          'round',
          'round.status IN (:...roundStatuses)',
        )
        .leftJoinAndSelect('round.bettingVariables', 'variable')
        .where('stream.id = :streamId', { streamId })
        .andWhere('stream.status = :streamStatus', {
          streamStatus: StreamStatus.LIVE,
        })
        .setParameters({
          roundStatuses: [BettingRoundStatus.OPEN, BettingRoundStatus.LOCKED],
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
      const result = {
        walletFreeToken: wallet?.freeTokens || 0,
        walletCoin: wallet?.streamCoins || 0,
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
    return await this.simplifyStreamResponse(stream);
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
      if (updateStreamDto.embeddedUrl !== undefined) {
        stream.embeddedUrl = updateStreamDto.embeddedUrl;
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

      return await this.streamsRepository.save(stream);
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
    const allRoundsTerminal = (stream.bettingRounds || []).every(
      (round) =>
        round.status === BettingRoundStatus.CLOSED ||
        round.status === BettingRoundStatus.CANCELLED,
    );
    if (!allRoundsTerminal) {
      throw new BadRequestException(
        'Cannot end stream: All rounds must be CLOSED or CANCELLED.',
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

  async incrementViewCount(streamId: string) {
    await this.streamsRepository
      .createQueryBuilder()
      .update(Stream)
      .set({ viewerCount: () => 'viewerCount + 1' })
      .where('id = :id', { id: streamId })
      .execute();
  }
  async decrementViewCount(streamId: string) {
    await this.streamsRepository
      .createQueryBuilder()
      .update(Stream)
      .set({ viewerCount: () => 'viewerCount - 1' })
      .where('id = :id', { id: streamId })
      .execute();
  }
}
