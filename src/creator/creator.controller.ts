import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Patch,
  ForbiddenException,
  HttpStatus,
  Query,
  Delete,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { BettingService } from '../betting/betting.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import {
  CreateBettingVariableDto,
  EditBettingVariableDto,
  UpdateRoundStatusDto,
} from '../betting/dto/create-betting-variable.dto';

import { ApiResponse } from '../common/types/api-response.interface';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiOkResponse,
} from '@nestjs/swagger';
import { UserFilterDto, UserUpdateDto } from 'src/users/dto/user.requests.dto';
import { StreamFilterDto } from 'src/stream/dto/list-stream.dto';
import { StreamService } from 'src/stream/stream.service';
import {
  AnalyticsSummaryResponseDto,
  StreamAnalyticsResponseDto,
} from './dto/analytics.dto';
import { StreamStatus } from 'src/enums/stream.enum';
import { UserRole } from 'src/enums/user-role.enum';
import { CreatorService } from './creator.service';
import { CreateStreamDto } from 'src/betting/dto/create-stream.dto';
import { UpdateStreamDto } from 'src/betting/dto/update-stream.dto';
import { PlatformPayoutService } from 'src/platform-payout/plaform-payout.service';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('creator')
@ApiBearerAuth()
@Controller('creator')
@UseGuards(JwtAuthGuard)
export class CreatorController {
  constructor(
    private readonly bettingService: BettingService,
    private readonly platformPayoutService: PlatformPayoutService,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly streamService: StreamService,
    private readonly creatorService: CreatorService,
  ) { }

  // Helper method to check if user is creator
  private ensureCreator(user: User) {
    if (user.role !== UserRole.CREATOR) {
      throw new ForbiddenException('Creator access required');
    }
  }

  // Stream Management
  @ApiOperation({ summary: 'Create a new stream' })
  @SwaggerApiResponse({
    status: 201,
    description: 'Stream created successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Creator access required',
  })
  @Post('streams')
  async createStream(
    @Request() req: RequestWithUser,
    @Body() createStreamDto: Omit<CreateStreamDto, "creatorId">,
  ): Promise<ApiResponse> {
    this.ensureCreator(req.user);
    const stream = await this.bettingService.createStream({
      ...createStreamDto,
      creatorId: req.user.id,
    });
    return {
      message: 'Successfully created stream',
      status: HttpStatus.CREATED,
      data: stream,
    };
  }

  @ApiOperation({ summary: 'Update stream status' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @ApiBody({
    schema: {
      properties: {
        status: {
          type: 'string',
          enum: Object.values(StreamStatus),
          description: 'New stream status',
        },
      },
    },
  })
  @SwaggerApiResponse({
    status: 200,
    description: 'Stream status updated successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Patch('streams/:id/status')
  async updateStreamStatus(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body('status') status: StreamStatus,
  ): Promise<ApiResponse> {
    this.ensureCreator(req.user);
    const updatedStream = await this.bettingService.updateStreamStatus(
      id,
      status,
    );
    return {
      message: 'Stream status updated successfully',
      status: HttpStatus.OK,
      data: updatedStream,
    };
  }

  // Betting Variable Management
  @ApiOperation({ summary: 'Create betting options' })
  @SwaggerApiResponse({
    status: 201,
    description: 'Betting variable created successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Creator access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Post('betting-variables')
  async createBettingVariable(
    @Request() req: RequestWithUser,
    @Body() createBettingVariableDto: CreateBettingVariableDto,
  ): Promise<ApiResponse> {
    this.ensureCreator(req.user);
    const grouped = await this.bettingService.createBettingVariable(
      req.user.role,
      req.user.id,
      createBettingVariableDto,
    );
    return {
      message: 'Betting variable created successfully',
      status: HttpStatus.CREATED,
      data: grouped,
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
  @ApiOperation({
    summary: 'List all the streams in the System',
    description:
      'API to list stream details.Implemented pagenation, range, sort and filter .Pass with parameter false if you want the results without pagination',
  })
  @ApiOkResponse({ type: UserFilterDto })
  @Get('streams')
  async allStreamsForAdmin(
    @Request() req: RequestWithUser,
    @Query() streamFilterDto: StreamFilterDto,
  ) {
    this.ensureCreator(req.user);
    const { total, data } =
      await this.streamService.allStreamsForAdmin(req.user.role, req.user.id, streamFilterDto);
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
      total,
    };
  }

  @ApiOperation({ summary: 'Fetch stream details' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Successfully fetch Stream details',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'User not found' })
  @Get('stream/:id')
  async getStreamDetails(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureCreator(req.user);
    const data = await this.streamService.findStreamDetailsForAdmin(req.user.role, req.user.id, id);
    return {
      message: 'Successfully fetch Stream details',
      status: HttpStatus.OK,
      data,
    };
  }

  @ApiOperation({
    summary: 'Get all rounds for a stream with winners and options',
  })
  @ApiParam({ name: 'streamId', description: 'Stream ID' })
  @Get('streams/:streamId/rounds')
  async getStreamRoundsWithWinners(
    @Request() req: RequestWithUser,
    @Param('streamId') streamId: string,
  ) {
    this.ensureCreator(req.user);
    const data = await this.bettingService.getStreamRoundsWithWinners(streamId);
    return {
      message: 'Details fetched successfully',
      status: HttpStatus.OK,
      data: data,
    };
  }

  /**
   * Retrieves analytics summary data for the admin dashboard.
   *
   * This endpoint returns key metrics including:
   * - Total number of active, non-deleted users with the USER role
   * - Total number of live streams
   * - Total number of active bets (implementation should be in bettingService)
   * - Total live time duration for all streams (formatted as a string)
   *
   * The endpoint is protected and only accessible by admin users.
   *
   * @param req - The request object containing the authenticated user
   * @returns An object containing the analytics summary data
   */
  @ApiOperation({ summary: 'Get analytics summary for dashboard' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Analytics summary fetched successfully',
    type: AnalyticsSummaryResponseDto,
  })
  @Get('analytics/summary')
  async getAnalyticsSummary(@Request() req: RequestWithUser) {
    this.ensureCreator(req.user);

    const data = await this.creatorService.getAnalyticsSummary({ creatorId: req.user.id });

    return {
      statusCode: HttpStatus.OK,
      message: 'Analytics summary fetched successfully',
      data: data
    };
  }

  @Get('payoutsHistory')
  async getCreatorPayoutsHistory(
    @Request() req: RequestWithUser,
    @Query() query: {
      page?: number;
      limit?: number;
    },
  ) {
    this.ensureCreator(req.user);

    const results = await this.platformPayoutService.getPayoutsByUserId({
      userId: req.user.id,
      pagination: { page: query.page, limit: query.limit }
    });

    return {
      statusCode: HttpStatus.OK,
      message: 'Creator payout history fetched successfully',
      data: results
    };
  }

  /**
   * Retrieves analytics summary data for a specific stream.
   *
   * This endpoint returns key metrics for a given stream, including:
   * - Total number of unique users who participated in the stream (placed a bet)
   * - Total bet value (sum of all bets placed on the stream)
   * - Total stream time (duration from scheduledStartTime to endTime, formatted as a string)
   *
   * The endpoint is protected and only accessible by admin users.
   *
   * @param streamId - The ID of the stream to summarize
   * @returns An object containing the analytics summary data for the stream
   */
  @ApiOperation({ summary: 'Get analytics summary for a specific stream' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Analytics summary for stream fetched successfully',
    type: StreamAnalyticsResponseDto,
  })
  @Get('analytics/stream/:streamId')
  async getStreamAnalyticsSummary(
    @Request() req: RequestWithUser,
    @Param('streamId') streamId: string,
  ) {
    this.ensureCreator(req.user);

    // Get stream details (including betting rounds and variables)
    const { totalUsers, totalStreamTime } =
      await this.streamService.getStreamAnalytics(req.user.role, req.user.id, streamId);

    // Get total bet value for the stream
    const totalBetValue =
      await this.bettingService.getTotalBetValueForStream(streamId);

    const totalBetPlacedUsers =
      await this.bettingService.getTotalBetPlacedUsersForStream(streamId);

    return {
      statusCode: HttpStatus.OK,
      message: 'Analytics summary fetched successfully',
      data: {
        totalUsers,
        totalStreamTime,
        totalBetValue,
        platformVig: '15%',
        totalBetPlacedUsers,
      },
    };
  }
}
