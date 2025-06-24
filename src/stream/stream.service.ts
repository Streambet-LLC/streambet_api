import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Stream } from './entities/stream.entity';
import { HomeStreamListFilterDto } from './dto/list-stream.dto';
import { Range } from 'src/common/filters/filter.dto';

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
    userFilterDto: HomeStreamListFilterDto,
  ): Promise<{ data: Stream[]; total: number }> {
    const range: Range = userFilterDto.range
      ? (JSON.parse(userFilterDto.range) as Range)
      : [0, 24];

    const { pagination = true, streamStatus } = userFilterDto;

    const streamQB = this.streamsRepository.createQueryBuilder('s');

    if (streamStatus) {
      streamQB.andWhere(`s.status = :streamStatus`, { streamStatus });
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
}
