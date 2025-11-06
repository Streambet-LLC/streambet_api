import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  HttpStatus,
  Param,
  Body,
} from '@nestjs/common';
import { StreamService } from './stream.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import {
  LiveScheduledStreamListDto,
  StreamFilterDto,
} from './dto/list-stream.dto';
import { Stream } from './entities/stream.entity';
import { UserIdDto } from 'src/users/dto/user.requests.dto';
// import { GeoFencingGuard } from 'src/auth/guards/geo-fencing.guard';
import { StreamResponseDto } from './dto/stream-detail.response.dto';
import { HomepageBetListDto } from './dto/homepage-bet-list.dto';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('stream')
@Controller('stream')
export class StreamController {
  constructor(private readonly streamService: StreamService) { }
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
   * @param liveScheduledStreamListDto - DTO containing optional sort and range for pagination.
   * @returns A Promise resolving to an object with:
   *          - data: Array of stream records with selected and derived fields.
   *          - total: Total number of matching stream records.
   * @throws HttpException - If an error occurs during query execution.
   * @author Reshma M S
   */

  @ApiOperation({
    summary: 'List live and scheduled streams for home page',
    description:
      'Retrieves a paginated list of live and scheduled streams for the home page view. \
Live streams are listed first (ordered by createdAt in descending order), followed by scheduled streams (ordered by scheduledStartTime in ascending order). \
Supports optional sorting and pagination (default range: [0, 24]). \
Pass "pagination=false" to retrieve all matching streams without pagination. \
Returns essential fields (id, name, status, viewerCount) along with derived values such as bettingRoundStatus and userBetCount.',
  })
  @ApiOkResponse({ type: LiveScheduledStreamListDto })
  // @UseGuards(GeoFencingGuard)
  @Get()
  async getScheduledAndLiveStreams(
    @Query() liveScheduledStreamListDto: LiveScheduledStreamListDto,
  ) {
    const { total, data } = await this.streamService.getScheduledAndLiveStreams(
      liveScheduledStreamListDto,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
      total,
    };
  }

  @ApiOperation({
    summary: 'List live bets for homepage',
  })
  @ApiOkResponse({ type: HomepageBetListDto })
  // @UseGuards(GeoFencingGuard)
  @Get('displayed-bets')
  async getDisplayedBets(
    @Query() homepageBetListDto: HomepageBetListDto,
  ) {
    const { data } = await this.streamService.getDisplayBets(
      homepageBetListDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
    };
  }


  @ApiOperation({
    summary: 'List upcoming bets for homepage',
  })
  @ApiOkResponse({ type: HomepageBetListDto })
  // @UseGuards(GeoFencingGuard)
  @Get('displayed-upcoming-bets')
  async getUpcomingBets(
    @Query() homepageBetListDto: HomepageBetListDto,
  ) {
    const { data } = await this.streamService.getUpcomingBets(
      homepageBetListDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
    };
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
  @ApiOperation({
    summary: 'List live and sheduled streams for home page',
    description:
      'Retrieves a list of users with support for pagination, range, and filtering. Pass "pagination=false" to retrieve all users without pagination.',
  })
  @ApiOkResponse({ type: StreamFilterDto })
  // @UseGuards(GeoFencingGuard)
  @Get('home')
  async homePageStreamList(@Query() streamFilterDto: StreamFilterDto) {
    const { total, data } =
      await this.streamService.homePageStreamList(streamFilterDto);
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
      total,
    };
  }

  @ApiOperation({
    summary: 'Lists top live streams',
  })
  // @UseGuards(GeoFencingGuard)
  @Get('top')
  async topLiveStreams() {
    const { data } =
      await this.streamService.getTopLivestreams();
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
    };
  }

  @ApiOperation({
    summary: 'Lists Promoted Bets',
  })
  // @UseGuards(GeoFencingGuard)
  @Get('promoted-bets')
  async promotedBets() {
    const { data } = await this.streamService.getTopPromotedBets();
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
    };
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
  /**
   * Retrieves detailed information about a stream by its ID.
   *
   * This endpoint is public and returns stream details only if the stream
   * is in LIVE, SCHEDULED, or ENDED status. The response includes:
   *   - Stream metadata (ID, name, platform, status, viewer count, etc.)
   *   - Betting rounds, sorted by `createdAt` in ascending order
   *   - Only the first occurrence of a "created" round is kept
   *   - Winning options for each round, along with winner details
   *
   * @param id - The unique identifier of the stream.
   * @returns An object containing stream details and betting round information.
   * @throws NotFoundException - If no stream with the given ID is found.
   * @throws HttpException (500) - For unexpected server errors.
   */
  @ApiOperation({
    summary: 'Retrieve stream details by ID',
    description: `
    Retrieves detailed information about a specific stream using its ID.
    - Works for streams with status: LIVE, SCHEDULED, or ENDED.
    - Includes betting rounds, winning options, and winners.
    - Ensures only the first "created" round is included, discarding duplicates.
    - Protected by GeoFencingGuard for region-based access restrictions.
  `,
  })
  @ApiResponse({
    status: 200,
    description: 'Stream details retrieved successfully.',
    type: StreamResponseDto,
  })
  // @UseGuards(GeoFencingGuard)
  @Get('/:id')
  async findStreamById(@Param('id') id: string): Promise<StreamResponseDto> {
    const stream = await this.streamService.findStreamById(id);
    return {
      message: 'Stream details retrieved successfully',
      status: HttpStatus.OK,
      data: stream,
    };
  }

  @ApiOperation({ summary: 'Get bet round details by stream id' })
  @ApiResponse({
    status: 200,
    description: 'Stream details retrieved successfully',
  })
  // @UseGuards(GeoFencingGuard)
  @Get('bet-round/:streamId')
  async findBetRoundDetailsByStreamId(
    @Param('streamId') streamId: string,
    @Query() userIdDto: UserIdDto,
  ) {
    const stream = await this.streamService.findBetRoundDetailsByStreamId(
      streamId,
      userIdDto?.userId,
    );
    return {
      message: 'Stream details retrieved successfully',
      status: HttpStatus.OK,
      data: stream,
    };
  }
}