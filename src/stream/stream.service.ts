import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Stream } from './entities/stream.entity';
import {
  HomeStreamListFilterDto,
  StreamFilterDto,
} from './dto/list-stream.dto';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';

@Injectable()
export class StreamService {
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
  ) {}
  /**
   * Retrieves a list of live or filtered streams for the homepage, with optional pagination.
   *
   * @param userFilterDto - The filter and pagination options, including:
   *   - streamStatus: (optional) The status of streams to filter by (e.g., 'live').
   *   - range: (optional) A JSON string representing the offset and limit for pagination.
   *   - pagination: (optional) A boolean to enable or disable pagination (defaults to true).
   *
   * @returns An object containing:
   *   - data: A list of raw stream records, each with id, streamName, and thumbnailURL.
   *   - total: The total number of matching streams.
   */
  async homePageStreamList(
    streamFilterDto: StreamFilterDto,
  ): Promise<{ data: Stream[]; total: number }> {
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
      .addSelect('s.thumbnailUrl', 'thumbnailURL');
    const total = await streamQB.getCount();
    const data = await streamQB.getRawMany();

    return { data, total };
  }

  async allStreamsForAdmin(
    streamFilterDto: StreamFilterDto,
  ): Promise<{ data: Stream[]; total: number }> {
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
    if (filter.q) {
      streamQB.andWhere(`(LOWER(s.name) ILIKE LOWER(:q) )`, {
        q: `%${filter.q}%`,
      });
    }
    if (streamStatus) {
      streamQB.andWhere(`s.status = :streamStatus`, { streamStatus });
    }
    // Sorting logic
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
    // Count before applying pagination
    const total = await streamQB.getCount();

    // Pagination logic
    if (pagination && range) {
      const [offset, limit] = range;
      streamQB.offset(offset).limit(limit);
    }
    // Fetch paginated or full data
    const data = await streamQB.getRawMany();
    return { data, total };
  }
}
