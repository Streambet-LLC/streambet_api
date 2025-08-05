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
} from '@nestjs/common';
import { BettingService } from '../betting/betting.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User, UserRole } from '../users/entities/user.entity';
import { CreateStreamDto } from '../betting/dto/create-stream.dto';
import { UpdateStreamDto } from '../betting/dto/update-stream.dto';
import {
  CreateBettingVariableDto,
  EditBettingVariableDto,
  UpdateRoundStatusDto,
} from '../betting/dto/create-betting-variable.dto';

import { BettingVariableStatus } from '../enums/betting-variable-status.enum';
import { ApiResponse } from '../common/types/api-response.interface';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { UserFilterDto, UserUpdateDto } from 'src/users/dto/user.requests.dto';
import { AdminService } from './admin.service';
import { SoftDeleteUserDto } from './dto/soft-delete-user.dto';
import { AddFreeTokenDto } from './dto/free-token-update.dto';
import { StreamStatus } from 'src/stream/entities/stream.entity';
import { StreamFilterDto } from 'src/stream/dto/list-stream.dto';
import { StreamService } from 'src/stream/stream.service';
import { AnalyticsSummaryResponseDto, StreamAnalyticsResponseDto } from './dto/analytics.dto';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private readonly bettingService: BettingService,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly adminService: AdminService,
    private readonly streamService: StreamService,
  ) {}

  // Helper method to check if user is admin
  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
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
    description: 'Forbidden - Admin access required',
  })
  @Post('streams')
  async createStream(
    @Request() req: RequestWithUser,
    @Body() createStreamDto: CreateStreamDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const stream = await this.bettingService.createStream(createStreamDto);
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
    this.ensureAdmin(req.user);
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

  @ApiOperation({ summary: 'Update stream details' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @ApiBody({ type: UpdateStreamDto })
  @SwaggerApiResponse({
    status: 200,
    description: 'Stream updated successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Patch('streams/:id')
  async updateStream(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateStreamDto: UpdateStreamDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const updatedStream = await this.streamService.updateStream(
      id,
      updateStreamDto,
    );
    return {
      message: 'Stream updated successfully',
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
    description: 'Forbidden- Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Post('betting-variables')
  async createBettingVariable(
    @Request() req: RequestWithUser,
    @Body() createBettingVariableDto: CreateBettingVariableDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const grouped = await this.bettingService.createBettingVariable(
      createBettingVariableDto,
    );
    return {
      message: 'Betting variable created successfully',
      status: HttpStatus.CREATED,
      data: grouped,
    };
  }

  @ApiOperation({ summary: 'Lock betting' })
  @ApiParam({ name: 'id', description: 'Betting variable ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Betting locked successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({
    status: 404,
    description: 'Betting variable not found',
  })
  @Patch('betting-variables/:id/lock')
  async lockBetting(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const lockedBetting = await this.bettingService.updateBettingVariableStatus(
      id,
      BettingVariableStatus.LOCKED,
    );
    return {
      message: 'Betting locked successfully',
      status: HttpStatus.OK,
      data: lockedBetting,
    };
  }

  @ApiOperation({ summary: 'Declare a winner' })
  @ApiParam({ name: 'id', description: 'Betting variable ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Winner declared and payouts processed successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({
    status: 404,
    description: 'Betting variable not found',
  })
  @Post('betting-variables/:id/declare-winner')
  async declareWinner(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const result = await this.bettingService.declareWinner(id);
    return {
      message: 'Winner declared and payouts processed successfully',
      status: HttpStatus.OK,
      data: result,
    };
  }

  @ApiOperation({ summary: 'Edit betting options for multiple rounds' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Betting variables updated successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden- Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Patch('betting-variables')
  async editBettingVariable(
    @Request() req: RequestWithUser,
    @Body() editBettingVariableDto: EditBettingVariableDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const grouped = await this.bettingService.editBettingVariable(
      editBettingVariableDto,
    );

    return {
      message: 'Betting variables updated successfully',
      status: HttpStatus.OK,
      data: grouped,
    };
  }

  // User Management

  @ApiOperation({ summary: "Adjust user's wallet balance" })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiBody({
    schema: {
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to add (positive) or subtract (negative)',
        },
        description: { type: 'string', description: 'Reason for adjustment' },
      },
    },
  })
  @SwaggerApiResponse({
    status: 200,
    description: 'Wallet balance adjusted successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'User not found' })
  @Patch('users/:id/wallet')
  async adjustWallet(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body('amount') amount: number,
    @Body('description') description: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const wallet = await this.walletsService.addFreeTokens(
      id,
      amount,
      description,
    );
    return {
      message: 'Wallet balance adjusted successfully',
      status: HttpStatus.OK,
      data: wallet,
    };
  }

  @ApiOperation({
    summary: `Activate or Deactivate user.`,
    description: 'API to activate or deactivate a user by their ID.',
  })
  @Patch('users')
  async updateUserStatus(
    @Body() userUpdateDto: UserUpdateDto,
    @Request() req: RequestWithUser,
  ) {
    this.ensureAdmin(req.user);
    const { result, message } =
      await this.usersService.updateUserStatus(userUpdateDto);
    return {
      statusCode: HttpStatus.OK,
      message,
      data: result,
    };
  }

  @ApiOperation({
    summary: 'List all the users in the System',
    description:
      'API to list users details.Implemented pagenation, range, sort and filter .Pass with parameter false if you want the results without pagination',
  })
  @ApiOkResponse({ type: UserFilterDto })
  @Get('users')
  async getAllUsers(
    @Request() req: RequestWithUser,
    @Query() userFilterDto: UserFilterDto,
  ) {
    this.ensureAdmin(req.user);
    const { total, data } = await this.usersService.findAllUser(userFilterDto);
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
      total,
    };
  }

  @ApiOperation({ summary: 'Soft delete a user' })
  @ApiOkResponse({
    description: 'User has been successfully soft deleted',
    type: User,
  })
  @ApiNotFoundResponse({
    description: 'User not found',
  })
  @Delete('users/soft-delete/:userId')
  async softDeleteUser(
    @Query() softDeleteUserDto: SoftDeleteUserDto,
  ): Promise<User> {
    return this.adminService.softDeleteUser(softDeleteUserDto.userId);
  }

  @ApiOperation({
    summary: `Add free token .`,
    description: 'API to add free token by admin.',
  })
  @Patch('tokens/free')
  async addFreeToken(
    @Body() addFreeTokenDto: AddFreeTokenDto,
    @Request() req: RequestWithUser,
  ) {
    this.ensureAdmin(req.user);
    const data =
      await this.adminService.updateFreeTokensByAdmin(addFreeTokenDto);
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully updated free tokens',
      data,
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
    this.ensureAdmin(req.user);
    const { total, data } =
      await this.streamService.allStreamsForAdmin(streamFilterDto);
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
    this.ensureAdmin(req.user);
    const data = await this.streamService.findStreamDetailsForAdmin(id);
    return {
      message: 'Successfully fetch Stream details',
      status: HttpStatus.OK,
      data,
    };
  }

  /**
   * Admin: Update the status of a round (created -> open -> locked, no reverse)
   */
  @ApiOperation({ summary: 'Update round status' })
  @ApiParam({ name: 'roundId', description: 'Round ID' })
  @ApiBody({ type: UpdateRoundStatusDto })
  @SwaggerApiResponse({
    status: 200,
    description: 'Round status updated successfully',
  })
  @SwaggerApiResponse({ status: 400, description: 'Invalid status transition' })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'Round not found' })
  @Patch('rounds/:roundId/status')
  async updateRoundStatus(
    @Request() req: RequestWithUser,
    @Param('roundId') roundId: string,
    @Body() body: UpdateRoundStatusDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);

    const updatedRound = await this.bettingService.updateRoundStatus(
      roundId,
      body.newStatus,
    );
    return {
      message: 'Round status updated successfully',
      status: HttpStatus.OK,
      data: updatedRound,
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
    this.ensureAdmin(req.user);
    const data = await this.adminService.getStreamRoundsWithWinners(streamId);
    return {
      message: 'Details fetched successfully',
      status: HttpStatus.OK,
      data: data,
    };
  }

  @ApiOperation({
    summary: 'End a stream if all rounds are closed or cancelled',
  })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Stream ended successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Patch('streams/:id/end')
  async endStreamById(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const endedStream =
      await this.streamService.endStreamIfAllRoundsClosedOrCancelled(id);
    return {
      message: 'Stream ended successfully',
      status: HttpStatus.OK,
      data: endedStream,
    };
  }

  @ApiOperation({ summary: 'Cancel a round and refund all bets' })
  @ApiParam({ name: 'roundId', description: 'Betting Round ID' })
  @Patch('rounds/:roundId/cancel')
  async cancelRoundAndRefund(
    @Request() req: RequestWithUser,
    @Param('roundId') roundId: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const result = await this.bettingService.cancelRoundAndRefund(roundId);
    return {
      message: 'Round cancelled and all bets refunded',
      status: HttpStatus.OK,
      data: result,
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
    this.ensureAdmin(req.user);

    // Total users
    const totalUsers = await this.usersService.getUsersCount();

    // Total live streams
    const totalLiveStreams = await this.streamService.getLiveStreamsCount();

    // Total active bets
    const totalActiveBets = await this.bettingService.getActiveBetsCount();

    const totalLiveTime = await this.streamService.getTotalLiveDuration();

    return {
      statusCode: HttpStatus.OK,
      message: 'Analytics summary fetched successfully',
      data: {
        totalUsers,
        totalActiveBets,
        totalLiveStreams,
        totalLiveTime
      },
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
    this.ensureAdmin(req.user);
  
    // Get stream details (including betting rounds and variables)
    const { totalUsers, totalStreamTime } = await this.streamService.getStreamAnalytics(streamId);
    
    // Get total bet value for the stream
    const totalBetValue = await this.bettingService.getTotalBetValueForStream(streamId);
    
    const totalBetPlacedUsers = await this.bettingService.getTotalBetPlacedUsersForStream(streamId);

    return {
      statusCode: HttpStatus.OK,
      message: 'Analytics summary fetched successfully',
      data: {
        totalUsers,
        totalStreamTime,
        totalBetValue,
        platformVig:'15%',
        totalBetPlacedUsers
      },
    };
  }
  /**
   * Cancel a scheduled stream by its stream ID.
   *
   * This endpoint cancels a scheduled stream, removes it from the processing queue,
   * updates its status to `CANCELED`, and cancels any associated betting rounds with refunds.
   *
   * @param streamId - The unique ID of the stream to cancel.
   * @returns A confirmation message with the stream ID.
   */
  @Patch('/stream/scheduled/cancel/:streamId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a scheduled stream by ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Stream successfully canceled',
    schema: {
      example: {
        data: '6ac9f2e4-42a2-4e75-9a2a-31ad4458f5ab',
        statusCode: 200,
        message:
          'Stream with ID 6ac9f2e4-42a2-4e75-9a2a-31ad4458f5ab has been canceled successfully.',
      },
    },
  })
  @SwaggerApiResponse({
    status: 400,
    description: 'Stream not found or already removed from queue',
    schema: {
      example: {
        statusCode: 400,
        message: 'Stream-MyStream not found in the queue or already removed.',
        error: 'Bad Request',
      },
    },
  })
  async cancelScheduledStream(
    @Request() req: RequestWithUser,
    @Param('streamId') streamId: string,
  ): Promise<{ message: string; data: String; statusCode: Number }> {
    this.ensureAdmin(req.user);
    const canceledStreamId = await this.streamService.canceledSheduledStream(
      streamId,
    );
    return {
      data: canceledStreamId,
      message: `Stream with ID ${canceledStreamId} has been canceled successfully.`,
      statusCode: HttpStatus.OK,
    };
  }
  /**
   * Soft Delete a scheduled stream by its stream ID. Update status to delete
   *
   * This endpoint delet a scheduled stream, removes it from the processing queue,
   * updates its status to `DELETED`, and cancels any associated betting rounds with refunds.
   *
   * @param streamId - The unique ID of the stream to delete.
   * @returns A confirmation message with the stream ID.
   */
  @Patch('/stream/scheduled/delete/:streamId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a scheduled stream by ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Stream successfully deleted',
    schema: {
      example: {
        data: '6ac9f2e4-42a2-4e75-9a2a-31ad4458f5ab',
        statusCode: 200,
        message:
          'Stream with ID 6ac9f2e4-42a2-4e75-9a2a-31ad4458f5ab has been deleted successfully.',
      },
    },
  })
  @SwaggerApiResponse({
    status: 400,
    description: 'Stream not found or already removed from queue',
    schema: {
      example: {
        statusCode: 400,
        message: 'Stream-MyStream not found in the queue or already removed.',
        error: 'Bad Request',
      },
    },
  })
  async deleteScheduledStream(
    @Request() req: RequestWithUser,
    @Param('streamId') streamId: string,
  ): Promise<{ message: string; data: String; statusCode: Number }> {
    this.ensureAdmin(req.user);
    const deletedStreamId =
      await this.streamService.deleteSheduledStream(streamId);
    return {
      data: deletedStreamId,
      message: `Stream with ID ${deletedStreamId} has been canceled successfully.`,
      statusCode: HttpStatus.OK,
    };
  }
}
