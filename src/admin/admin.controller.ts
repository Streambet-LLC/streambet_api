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
import { User } from '../users/entities/user.entity';
import { CreateStreamDto } from '../betting/dto/create-stream.dto';
import { UpdateStreamDto } from '../betting/dto/update-stream.dto';
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
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import {
  ProfileUpdateDto,
  UserFilterDto,
  UserUpdateDto,
} from 'src/users/dto/user.requests.dto';
import { AdminService } from './admin.service';
import { CollectorAnalyticsService } from './collector-analytics.service';
import {
  CollectorAnalyticsOverviewDto,
  CollectorProfileDetailDto,
  CollectorProfileSummaryDto,
  CreateCollectorProfileDto,
  UpdateCollectorAnalyticsProfileDto,
  UpdateCollectorSocialsDto,
} from './dto/collector-analytics.dto';
import { SoftDeleteUserDto } from './dto/soft-delete-user.dto';
import { StreamFilterDto } from 'src/stream/dto/list-stream.dto';
import { StreamService } from 'src/stream/stream.service';
import {
  AdminAnalyticsSummaryResponseDto,
  StreamAnalyticsResponseDto,
} from './dto/analytics.dto';
import { AddGoldCoinDto, UpdateCoinDto } from './dto/coin-update.dto';
import { UpdateUserFeeOverrideDto } from './dto/update-user-fee-override.dto';
import { StreamStatus } from 'src/enums/stream.enum';
import { UserRole } from 'src/enums/user-role.enum';
import { ViewBetDto } from 'src/betting/dto/view-bet.dto';
import { CreatorService } from 'src/creator/creator.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { SubscriptionPlan } from 'src/enums/subscription-plan.enum';
import { PromoCodeService } from 'src/promo-code/promo-code.service';
import {
  CreateDiscountCodeDto,
  UpdateDiscountCodeDto,
} from './dto/discount-code.dto';
import {
  CreatePromoCodeDto,
  UpdatePromoCodeDto,
} from './dto/promo-code.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrizeOrder } from 'src/prize/entities/prize-order.entity';
import { PrizeConfiguration } from 'src/prize/entities/prize-configuration.entity';
import { getEffectiveSellerFeePercent } from 'src/common/utils/fee-utils';
import {
  ConciergeRequest,
  ConciergeRequestStatus,
} from 'src/concierge/entities/concierge-request.entity';

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
    private readonly collectorAnalyticsService: CollectorAnalyticsService,
    private readonly streamService: StreamService,
    private readonly creatorService: CreatorService,
    private readonly subscriptionService: SubscriptionService,
    private readonly promoCodeService: PromoCodeService,
    @InjectRepository(PrizeOrder)
    private readonly prizeOrderRepository: Repository<PrizeOrder>,
    @InjectRepository(PrizeConfiguration)
    private readonly prizeConfigurationRepository: Repository<PrizeConfiguration>,
    @InjectRepository(ConciergeRequest)
    private readonly conciergeRequestRepository: Repository<ConciergeRequest>,
  ) {}

  // Helper method to check if user is admin
  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  private ensureAdminOrCreator(user: User) {
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
    this.ensureAdminOrCreator(req.user);

    // Only admins can modify the isPromoted field
    if (
      updateStreamDto.isPromoted !== undefined &&
      req.user.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('Only admins can promote or demote streams');
    }

    const updatedStream = await this.streamService.updateStream(
      req.user.role,
      req.user.id,
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
    this.ensureAdminOrCreator(req.user);
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
    const lockedBetting = await this.bettingService.lockBetting(id);
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
    this.ensureAdminOrCreator(req.user);
    const result = await this.bettingService.declareWinner(
      req.user.role,
      req.user.id,
      id,
    );
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
    this.ensureAdminOrCreator(req.user);
    const grouped = await this.bettingService.editBettingVariable(
      req.user.role,
      req.user.id,
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
    const wallet = await this.walletsService.addGoldCoins(
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
    summary: 'Set permanent seller fee override',
    description:
      'Sets the seller fee override percent (2-4). This override takes precedence over milestone-based fee tiers.',
  })
  @ApiParam({ name: 'id', description: 'Seller user ID' })
  @ApiBody({ type: UpdateUserFeeOverrideDto })
  @Patch('users/:id/fee-override')
  async updateSellerFeeOverride(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserFeeOverrideDto,
  ) {
    this.ensureAdmin(req.user);
    const user = await this.adminService.updateSellerFeeOverride(
      id,
      dto.feePercent,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Seller fee override updated successfully',
      data: {
        id: user.id,
        applicationFeePercent: Number(user.applicationFeePercent),
        adminFeeOverridePercent:
          user.adminFeeOverridePercent !== null &&
          user.adminFeeOverridePercent !== undefined
            ? Number(user.adminFeeOverridePercent)
            : null,
      },
    };
  }

  @ApiOperation({
    summary: 'Clear permanent seller fee override',
    description:
      'Removes the seller fee override and restores milestone-driven fee behavior.',
  })
  @ApiParam({ name: 'id', description: 'Seller user ID' })
  @Delete('users/:id/fee-override')
  @HttpCode(HttpStatus.OK)
  async clearSellerFeeOverride(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    this.ensureAdmin(req.user);
    const user = await this.adminService.clearSellerFeeOverride(id);

    return {
      statusCode: HttpStatus.OK,
      message: 'Seller fee override cleared successfully',
      data: {
        id: user.id,
        applicationFeePercent: Number(user.applicationFeePercent),
        adminFeeOverridePercent: null,
      },
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

  @ApiOperation({
    summary: 'Get all creators',
    description: 'API to list all possible creators',
  })
  @ApiOkResponse({ type: UserFilterDto })
  @Get('creators')
  async getAllCreators(@Request() req: RequestWithUser) {
    this.ensureAdmin(req.user);
    const { data } = await this.usersService.findAllCreators();
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
    };
  }

  @ApiOperation({
    summary: 'Get all sellers',
    description: 'API to list all active sellers',
  })
  @ApiOkResponse()
  @Get('sellers')
  async getAllSellers(@Request() req: RequestWithUser) {
    this.ensureAdmin(req.user);
    const { data } = await this.usersService.findAllSellers();
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
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
    return this.usersService.softDeleteUser(softDeleteUserDto.userId);
  }

  @ApiOperation({
    summary: `Update user coins`,
    description: 'Generic API to update any currency type by admin.',
  })
  @SwaggerApiResponse({
    status: 200,
    description: 'Coins updated successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'User wallet not found' })
  @Patch('coins')
  async updateCoins(
    @Body() updateCoinDto: UpdateCoinDto,
    @Request() req: RequestWithUser,
  ) {
    this.ensureAdmin(req.user);
    const data = await this.adminService.updateCoinsByAdmin(updateCoinDto);
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully updated coins',
      data,
    };
  }

  @ApiOperation({
    summary: `Add Gold Coin .`,
    description: 'API to add Gold Coin by admin.',
  })
  @Patch('gold-coins')
  async addGoldCoin(
    @Body() addGoldCoinDto: AddGoldCoinDto,
    @Request() req: RequestWithUser,
  ) {
    this.ensureAdmin(req.user);
    const data = await this.adminService.updateGoldCoinsByAdmin(addGoldCoinDto);
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully updated Gold Coins',
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
    const { total, data } = await this.streamService.allStreamsForAdmin(
      req.user.role,
      req.user.id,
      streamFilterDto,
    );
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
    this.ensureAdminOrCreator(req.user);
    const data = await this.streamService.findStreamDetailsForAdmin(
      req.user.role,
      req.user.id,
      id,
    );
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
    this.ensureAdminOrCreator(req.user);

    const updatedRound = await this.bettingService.updateRoundStatus(
      req.user.role,
      req.user.id,
      roundId,
      body.newStatus,
    );
    return {
      message: 'Round status updated successfully',
      status: HttpStatus.OK,
      data: updatedRound,
    };
  }

  @ApiOperation({ summary: 'Toggle round visibility on landing page' })
  @ApiParam({ name: 'roundId', description: 'Round ID' })
  @ApiBody({ type: UpdateRoundStatusDto })
  @SwaggerApiResponse({
    status: 200,
    description: 'Round visibility on landing page updated successfully',
  })
  @SwaggerApiResponse({ status: 400, description: 'Invalid status transition' })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'Round not found' })
  @Patch('rounds/:roundId/landing-visiblity')
  async updateBetRoundLandingVisibility(
    @Request() req: RequestWithUser,
    @Param('roundId') roundId: string,
    @Body()
    body: {
      hidden: boolean;
    },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);

    await this.bettingService.updateBetRoundLandingVisibility(
      roundId,
      body.hidden,
    );

    return {
      message: 'Round visibility on landing page updated successfully',
      status: HttpStatus.OK,
      data: null,
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
    this.ensureAdminOrCreator(req.user);
    const data = await this.bettingService.getStreamRoundsWithWinners(streamId);
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
    this.ensureAdminOrCreator(req.user);
    const endedStream =
      await this.streamService.endStreamIfAllRoundsClosedOrCancelled(
        req.user.role,
        req.user.id,
        id,
      );
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
    this.ensureAdminOrCreator(req.user);
    const result = await this.bettingService.cancelRoundAndRefund(
      req.user.role,
      req.user.id,
      roundId,
    );
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
    type: AdminAnalyticsSummaryResponseDto,
  })
  @Get('analytics/summary')
  async getAnalyticsSummary(@Request() req: RequestWithUser) {
    this.ensureAdmin(req.user);

    // Total users
    const totalUsers = await this.usersService.getUsersCount();

    // Total cards listed (active prize configurations)
    const totalCardsListed = await this.prizeConfigurationRepository.count({
      where: { isActive: true },
    });

    // Concierge requests (pending — claimed ones are excluded)
    const totalConciergeRequests = await this.conciergeRequestRepository.count({
      where: { status: ConciergeRequestStatus.PENDING },
    });

    // Monthly fees earned (current calendar month)
    const NON_CRYPTO_BUYER_FEE_PCT = 3;
    const CRYPTO_BUYER_FEE_BPS = 100;
    const CRYPTO_DEFAULT_SELLER_FEE_BPS = 100;

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    // New users created month-to-date
    const newUsersMonthToDate =
      await this.usersService.getUsersCountSince(monthStart);

    const feeRows = await this.prizeOrderRepository
      .createQueryBuilder('o')
      .leftJoin('o.prizeConfiguration', 'prize')
      .leftJoin('prize.creator', 'seller')
      .leftJoin('seller.wallet', 'wallet')
      .select('o.payment_method', 'payment_method')
      .addSelect('COALESCE(o.total_price, 0)', 'total_price')
      .addSelect('COALESCE(prize.shipping_cost_usd, 0)', 'shipping_cost_usd')
      .addSelect('seller.stripe_account_id', 'seller_stripe_account_id')
      .addSelect(
        'seller.admin_fee_override_percent',
        'seller_admin_fee_override_percent',
      )
      .addSelect('wallet.lifetime_coins_earned', 'seller_lifetime_coins_earned')
      .addSelect(
        'seller.crypto_override_fee_bps',
        'seller_crypto_override_fee_bps',
      )
      .where("o.status IN ('paid', 'shipped', 'delivered')")
      .andWhere('o.createdAt >= :monthStart', { monthStart })
      .getRawMany<{
        payment_method: 'coins' | 'usd' | 'combined' | 'crypto';
        total_price: string | null;
        shipping_cost_usd: string | null;
        seller_stripe_account_id: string | null;
        seller_admin_fee_override_percent: string | null;
        seller_lifetime_coins_earned: string | null;
        seller_crypto_override_fee_bps: string | null;
      }>();

    const toCents = (usd: number): number => Math.round(usd * 100);
    const toUsd = (cents: number): number => cents / 100;
    const round2 = (usd: number): number => Math.round(usd * 100) / 100;

    let monthlyFeesEarned = 0;
    // CardCade primary sales = orders where CardCade itself is the seller
    // (admin-owned prizes — no seller Stripe Connect account). We report the
    // item subtotal (excluding the buyer service fee) here so the two cards
    // on the dashboard don't double-count revenue.
    let monthlyPrimarySales = 0;
    for (const row of feeRows) {
      const totalPriceUsd = parseFloat(row.total_price ?? '0');
      if (!Number.isFinite(totalPriceUsd) || totalPriceUsd <= 0) {
        continue;
      }

      if (row.payment_method === 'crypto') {
        const sellerFeeBps =
          row.seller_crypto_override_fee_bps !== null &&
          row.seller_crypto_override_fee_bps !== undefined
            ? Number(row.seller_crypto_override_fee_bps)
            : CRYPTO_DEFAULT_SELLER_FEE_BPS;
        monthlyFeesEarned +=
          (totalPriceUsd * (CRYPTO_BUYER_FEE_BPS + sellerFeeBps)) / 10000;
        continue;
      }

      // total_price = subtotal + buyerFee, where buyerFee is 3% of
      // (subtotal - shipping). Solve subtotal from stored total_price.
      const shippingUsd = Math.max(0, parseFloat(row.shipping_cost_usd ?? '0'));
      const subtotalUsd =
        (totalPriceUsd + (NON_CRYPTO_BUYER_FEE_PCT / 100) * shippingUsd) /
        (1 + NON_CRYPTO_BUYER_FEE_PCT / 100);
      const itemSubtotalUsd = Math.max(0, subtotalUsd - shippingUsd);

      const buyerFeeCents = Math.round(
        toCents(itemSubtotalUsd) * (NON_CRYPTO_BUYER_FEE_PCT / 100),
      );

      // CardCade-as-seller (admin-owned prize): the platform keeps the full
      // capture but only the buyer service fee is a fee — the rest is
      // primary-sale revenue. There is no seller transfer/split.
      if (!row.seller_stripe_account_id) {
        monthlyFeesEarned += toUsd(buyerFeeCents);
        monthlyPrimarySales += subtotalUsd;
        continue;
      }

      const sellerFeePercent = getEffectiveSellerFeePercent({
        lifetimeCadeCoins: Number(row.seller_lifetime_coins_earned ?? 0),
        adminFeeOverridePercent:
          row.seller_admin_fee_override_percent !== null &&
          row.seller_admin_fee_override_percent !== undefined
            ? Number(row.seller_admin_fee_override_percent)
            : null,
      });
      const sellerFeeCents = Math.round(
        toCents(subtotalUsd) * (sellerFeePercent / 100),
      );

      monthlyFeesEarned += toUsd(buyerFeeCents + sellerFeeCents);
    }

    monthlyFeesEarned = round2(monthlyFeesEarned);
    monthlyPrimarySales = round2(monthlyPrimarySales);

    return {
      statusCode: HttpStatus.OK,
      message: 'Analytics summary fetched successfully',
      data: {
        totalUsers,
        newUsersMonthToDate,
        monthlyFeesEarned,
        monthlyPrimarySales,
        totalCardsListed,
        totalConciergeRequests,
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
    const { totalUsers, totalStreamTime } =
      await this.streamService.getStreamAnalytics(
        req.user.role,
        req.user.id,
        streamId,
      );

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

  /**
   * Aggregated collector analytics overview (real buy/sell data).
   */
  @ApiOperation({ summary: 'Collector analytics overview (real buy/sell data)' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Collector analytics overview fetched successfully',
    type: CollectorAnalyticsOverviewDto,
  })
  @Get('analytics/collectors/overview')
  async getCollectorsOverview(
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.collectorAnalyticsService.getOverview();
    return {
      status: HttpStatus.OK,
      message: 'Collector analytics overview fetched successfully',
      data,
    };
  }

  /**
   * Paginated collector profiles enriched with spend + category mix + socials.
   */
  @ApiOperation({ summary: 'List collector profiles with real buy/sell aggregates' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Collector profiles fetched successfully',
  })
  @Get('analytics/collectors')
  async listCollectorProfiles(
    @Request() req: RequestWithUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
    @Query('onlySellers') onlySellers?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : undefined;
    const result: { total: number; data: CollectorProfileSummaryDto[] } =
      await this.collectorAnalyticsService.listProfiles({
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
        offset: Number.isFinite(parsedOffset) ? parsedOffset : undefined,
        search,
        onlySellers: onlySellers === 'true' || onlySellers === '1',
      });
    return {
      status: HttpStatus.OK,
      message: 'Collector profiles fetched successfully',
      data: result,
    };
  }

  /**
   * Admin-only: create a new collector profile. Backs a real (non-login)
   * `users` row so it shows up in the Analytics list and can be annotated
   * like any other profile.
   */
  @ApiOperation({ summary: 'Create a new collector profile (admin-only)' })
  @SwaggerApiResponse({
    status: 201,
    description: 'Collector profile created successfully',
    type: CollectorProfileDetailDto,
  })
  @Post('analytics/collectors')
  async createCollectorProfile(
    @Request() req: RequestWithUser,
    @Body() dto: CreateCollectorProfileDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.collectorAnalyticsService.createProfile(
      dto,
      req.user.id,
    );
    return {
      status: HttpStatus.CREATED,
      message: 'Collector profile created successfully',
      data,
    };
  }

  /**
   * Single collector profile detail with category breakdown + recent orders.
   */
  @ApiOperation({ summary: 'Get a single collector profile detail' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Collector profile fetched successfully',
    type: CollectorProfileDetailDto,
  })
  @Get('analytics/collectors/:id')
  async getCollectorProfile(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.collectorAnalyticsService.getProfileDetail(id);
    return {
      status: HttpStatus.OK,
      message: 'Collector profile fetched successfully',
      data,
    };
  }

  /**
   * Admin-only: replace the user's `socials` jsonb. Used by the Analytics
   * surface to inject / correct connected social accounts.
   */
  @ApiOperation({
    summary: "Update a collector's connected socials (admin-only)",
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @Patch('analytics/collectors/:id/socials')
  async updateCollectorSocials(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateCollectorSocialsDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.collectorAnalyticsService.updateSocials(
      id,
      dto,
      req.user.id,
    );
    return {
      status: HttpStatus.OK,
      message: 'Collector socials updated successfully',
      data,
    };
  }

  /**
   * Admin-only: merge analytics annotations (notes, persona override,
   * interests, etc.) into `users.analytics_profile`. Consumed by the
   * future AI integration.
   */
  @ApiOperation({
    summary:
      "Update a collector's analytics profile annotations (admin-only)",
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @Patch('analytics/collectors/:id/profile')
  async updateCollectorAnalyticsProfile(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateCollectorAnalyticsProfileDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.collectorAnalyticsService.updateAnalyticsProfile(
      id,
      dto,
      req.user.id,
    );
    return {
      status: HttpStatus.OK,
      message: 'Collector analytics profile updated successfully',
      data,
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
  ): Promise<{ message: string; data: string; statusCode: number }> {
    this.ensureAdminOrCreator(req.user);
    const canceledStreamId = await this.streamService.cancelScheduledStream(
      req.user.role,
      req.user.id,
      streamId,
    );
    return {
      data: canceledStreamId,
      message: `Stream with ID ${canceledStreamId} has been canceled successfully.`,
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({ summary: 'Get a user profile' })
  @Get('user/:userId/profile')
  async getUserProfile(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
  ) {
    this.ensureAdminOrCreator(req.user);

    const data = await this.adminService.getUserProfile(userId);
    return {
      data,
      message: 'User profile fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({ summary: 'Update a user profile' })
  @Patch('user/:userId/profile')
  async updateUserProfile(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
    @Body()
    profileUpdateDto: Omit<
      ProfileUpdateDto,
      'password' | 'currentPassword' | 'newPassword'
    >,
  ) {
    this.ensureAdminOrCreator(req.user);

    const data = await this.usersService.profileUpdate(
      userId,
      profileUpdateDto,
    );
    return {
      data,
      message: 'User profile updated successfully',
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
  @Delete('/stream/scheduled/delete/:streamId')
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
  ): Promise<{ message: string; data: string; statusCode: number }> {
    this.ensureAdminOrCreator(req.user);
    const deletedStreamId = await this.streamService.deleteScheduledStream(
      req.user.role,
      req.user.id,
      streamId,
    );
    return {
      // @ts-ignore
      data: deletedStreamId,
      message: `Stream with ID ${deletedStreamId} has been deleted successfully.`,
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({
    summary: 'Bet Details per round',
  })
  @ApiOkResponse({ type: ViewBetDto })
  @Get('view-bets')
  async getBetsPerRound(
    @Request() req: RequestWithUser,
    @Query() viewBetDto: ViewBetDto,
  ) {
    this.ensureAdmin(req.user);
    const { total, data } =
      await this.bettingService.getBetsPerRound(viewBetDto);

    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
      total,
    };
  }

  // Seller Onboarding Management
  @ApiOperation({
    summary:
      'List sellers who have not completed Stripe onboarding (admin only)',
  })
  @SwaggerApiResponse({
    status: 200,
    description: 'Sellers with pending onboarding fetched successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @Get('sellers/pending-onboarding')
  async getSellersPendingOnboarding(
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.creatorService.getSellersWithPendingOnboarding();
    return {
      status: HttpStatus.OK,
      message: 'Sellers with pending onboarding fetched successfully',
      data,
    };
  }

  @ApiOperation({
    summary: 'Get all sellers with live Stripe account status (admin only)',
  })
  @SwaggerApiResponse({
    status: 200,
    description: 'Seller Stripe status fetched successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @Get('sellers/stripe-status')
  async getSellersStripeStatus(
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.creatorService.getAllSellersStripeStatus();
    return {
      status: HttpStatus.OK,
      message: 'Seller Stripe status fetched successfully',
      data,
    };
  }

  @ApiOperation({
    summary: 'Mark a seller as having completed Stripe onboarding (admin only)',
  })
  @ApiParam({ name: 'userId', description: 'User ID of the seller' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Seller onboarding marked as completed',
  })
  @SwaggerApiResponse({ status: 400, description: 'User is not a seller' })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'User not found' })
  @Patch('sellers/:userId/complete-onboarding')
  async markSellerOnboardingComplete(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    await this.creatorService.markSellerOnboardingComplete(userId);
    return {
      status: HttpStatus.OK,
      message: 'Seller onboarding marked as completed',
      data: true,
    };
  }

  // CardCade Pro Management

  @ApiOperation({ summary: 'Grant CardCade Pro to a user' })
  @SwaggerApiResponse({ status: 200, description: 'Pro granted successfully' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'User not found' })
  @Post('pro/grant/:userId')
  async grantPro(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
    @Body() body: { plan?: SubscriptionPlan },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const subscription = await this.subscriptionService.adminGrantPro(
      userId,
      body.plan || SubscriptionPlan.MONTHLY,
    );
    return {
      status: HttpStatus.OK,
      message: 'CardCade Pro granted successfully',
      data: subscription,
    };
  }

  @ApiOperation({ summary: 'Revoke CardCade Pro from a user' })
  @SwaggerApiResponse({ status: 200, description: 'Pro revoked successfully' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @Post('pro/revoke/:userId')
  async revokePro(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    await this.subscriptionService.adminRevokePro(userId);
    return {
      status: HttpStatus.OK,
      message: 'CardCade Pro revoked successfully',
      data: true,
    };
  }

  // ── Auctions Feature Flag ──

  @ApiOperation({ summary: 'Enable or disable auctions for a user' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Auctions flag updated successfully',
  })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'User not found' })
  @Patch('users/:userId/auctions-enabled')
  async setUserAuctionsEnabled(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
    @Body() body: { enabled: boolean },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const { user, wasNewlyEnabled } =
      await this.adminService.setAuctionsEnabled(userId, !!body?.enabled);
    return {
      status: HttpStatus.OK,
      message: body?.enabled
        ? 'Auctions enabled for user'
        : 'Auctions disabled for user',
      data: {
        userId: user.id,
        auctionsEnabled: user.auctionsEnabled,
        emailSent: wasNewlyEnabled,
      },
    };
  }

  // ── Discount Code Management ──

  @ApiOperation({ summary: 'List all discount codes' })
  @SwaggerApiResponse({ status: 200, description: 'Discount codes fetched' })
  @Get('discount-codes')
  async getDiscountCodes(
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.promoCodeService.findAllDiscountCodes();
    return {
      status: HttpStatus.OK,
      message: 'Discount codes fetched successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Create a new discount code' })
  @SwaggerApiResponse({ status: 201, description: 'Discount code created' })
  @Post('discount-codes')
  async createDiscountCode(
    @Request() req: RequestWithUser,
    @Body() dto: CreateDiscountCodeDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.promoCodeService.createDiscountCode({
      code: dto.code,
      discountType: dto.discountType,
      discountPercent: dto.discountPercent,
      discountAmountCents: dto.discountAmountCents,
      usageType: dto.usageType,
      maxUses: dto.maxUses,
      scope: dto.scope,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });
    return {
      status: HttpStatus.CREATED,
      message: 'Discount code created successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Update an existing discount code' })
  @SwaggerApiResponse({ status: 200, description: 'Discount code updated' })
  @ApiParam({ name: 'id', description: 'Discount code ID' })
  @Patch('discount-codes/:id')
  async updateDiscountCode(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateDiscountCodeDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const updates: Record<string, any> = {};
    if (dto.discountType !== undefined) updates.discountType = dto.discountType;
    if (dto.discountPercent !== undefined)
      updates.discountPercent = dto.discountPercent;
    if (dto.discountAmountCents !== undefined)
      updates.discountAmountCents = dto.discountAmountCents;
    if (dto.usageType !== undefined) updates.usageType = dto.usageType;
    if (dto.maxUses !== undefined) updates.maxUses = dto.maxUses;
    if (dto.scope !== undefined) updates.scope = dto.scope;
    if (dto.isActive !== undefined) updates.isActive = dto.isActive;
    if (dto.expiresAt !== undefined) {
      updates.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    const data = await this.promoCodeService.updateDiscountCode(id, updates);
    return {
      status: HttpStatus.OK,
      message: 'Discount code updated successfully',
      data,
    };
  }

  // ── Promo Code Management (signup coin bonus codes) ──

  @ApiOperation({ summary: 'List all signup-bonus promo codes' })
  @SwaggerApiResponse({ status: 200, description: 'Promo codes fetched' })
  @Get('promo-codes')
  async getPromoCodes(
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.promoCodeService.findAllPromoCodes();
    return {
      status: HttpStatus.OK,
      message: 'Promo codes fetched successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Create a new signup-bonus promo code' })
  @SwaggerApiResponse({ status: 201, description: 'Promo code created' })
  @Post('promo-codes')
  async createPromoCode(
    @Request() req: RequestWithUser,
    @Body() dto: CreatePromoCodeDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.promoCodeService.createPromoCode({
      code: dto.code,
      amount: dto.amount,
      isActive: dto.isActive,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    return {
      status: HttpStatus.CREATED,
      message: 'Promo code created successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Update an existing signup-bonus promo code' })
  @SwaggerApiResponse({ status: 200, description: 'Promo code updated' })
  @ApiParam({ name: 'id', description: 'Promo code ID' })
  @Patch('promo-codes/:id')
  async updatePromoCode(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdatePromoCodeDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const updates: {
      amount?: number;
      isActive?: boolean;
      expiresAt?: Date | null;
    } = {};
    if (dto.amount !== undefined) updates.amount = dto.amount;
    if (dto.isActive !== undefined) updates.isActive = dto.isActive;
    if (dto.expiresAt !== undefined) {
      updates.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    const data = await this.promoCodeService.updatePromoCode(id, updates);
    return {
      status: HttpStatus.OK,
      message: 'Promo code updated successfully',
      data,
    };
  }
}
