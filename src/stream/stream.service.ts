import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Stream } from './entities/stream.entity';
import { StreamFilterDto } from './dto/list-stream.dto';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';

@Injectable()
export class StreamService {
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
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

      const streamQB = this.streamsRepository.createQueryBuilder('s');
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
        .addSelect('s.viewerCount', 'viewerCount');
      const total = await streamQB.getCount();
      if (pagination && range) {
        const [offset, limit] = range;
        streamQB.offset(offset).limit(limit);
      }
      const data = await streamQB.getRawMany();
      return { data, total };
    } catch (e) {
      Logger.error('Unable to list stream details', e);
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
        where: { id },
        select: {
          id: true,
          embeddedUrl: true,
          name: true,
          platformName: true,
        },
      });

      if (!stream) {
        throw new NotFoundException(`Stream with ID ${id} not found`);
      }
      return stream;
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw e;
      }

      Logger.error('Unable to retrieve stream details', e);
      throw new HttpException(
        `Unable to retrieve stream details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  async findStreamDetailsForAdmin(id: string): Promise<Stream> {
    try {
      const stream = await this.streamsRepository.findOne({
        where: { id },
        relations: ['bettingRounds', 'bettingRounds.bettingVariables'],
      });

      if (!stream) {
        throw new NotFoundException(`Stream with ID ${id} not found`);
      }
      return stream;
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw e;
      }

      Logger.error('Unable to retrieve stream details', e);
      throw new HttpException(
        `Unable to retrieve stream details at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
