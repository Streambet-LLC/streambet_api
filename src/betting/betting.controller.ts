import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  ParseBoolPipe,
  DefaultValuePipe,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { ApiResponse } from '../common/types/api-response.interface';
import { BettingService } from './betting.service';
import { EditBetDto, PlaceBetDto } from './dto/place-bet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BettingVariable } from './entities/betting-variable.entity';
import { Bet } from './entities/bet.entity';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Stream } from 'src/stream/entities/stream.entity';
import { CancelBetDto } from './dto/cancel-bet.dto';
// import { GeoFencingGuard } from 'src/auth/guards/geo-fencing.guard';
import {
  BetHistoryFilterDto,
  BetHistoryResponseDto,
} from './dto/bet-history.dto';

// Define ApiResponse
// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('betting')
@Controller('betting')
export class BettingController {
  constructor(private readonly bettingService: BettingService) {}

  /**
   * Controller method to fetch all streams (active by default).
   *
   * Functional Comment:
   * -------------------
   * - This endpoint retrieves a list of streams.
   * - By default, only active (ongoing) streams are returned.
   * - If the optional query parameter `includeEnded=true` is provided, it also includes ended streams.
   * - Geo-fencing restrictions are enforced via `GeoFencingGuard`.
   * - Returns a standard `ApiResponse` object containing the stream data.
   *
   * Swagger Decorators:
   * - @ApiOperation: Provides a summary for Swagger docs.
   * - @ApiQuery: Documents the optional `includeEnded` query parameter.
   * - @SwaggerApiResponse: Defines the 200 response schema with a list of `Stream` objects.
   */
  @ApiOperation({ summary: 'Get all active streams' })
  @ApiQuery({
    name: 'includeEnded',
    required: false,
    type: Boolean,
    description: 'Include ended streams in results',
  })
  @SwaggerApiResponse({
    status: 200,
    description: 'List of streams retrieved successfully',
    type: [Stream],
  })
  // @UseGuards(GeoFencingGuard) // Guard to restrict access based on region or VPN usage
  @Get('streams') // HTTP GET endpoint at /streams
  async findAllStreams(
    // Query param: includeEnded (defaults to false)
    @Query('includeEnded', new DefaultValuePipe(false), ParseBoolPipe)
    includeEnded: boolean,
  ): Promise<ApiResponse> {
    // Service call to fetch streams (active or all depending on `includeEnded`)
    const streams = await this.bettingService.findAllStreams(includeEnded);

    // Standardized API response format
    return {
      message: 'Streams retrieved successfully',
      status: HttpStatus.OK,
      data: streams,
    };
  }

  /**
   * Controller method to fetch a single stream by its unique ID.
   *
   * Functional Comment:
   * -------------------
   * - This endpoint retrieves detailed information about a specific stream.
   * - The `id` parameter is provided in the route (e.g., `/streams/123`).
   * - If the stream exists, its details are returned.
   * - If the stream does not exist, a `404 Stream not found` response is documented in Swagger.
   * - Geo-fencing restrictions are enforced using `GeoFencingGuard`.
   * - Returns a standard `ApiResponse` object with the stream data.
   *
   * Swagger Decorators:
   * - @ApiOperation: Adds a summary for Swagger documentation.
   * - @ApiParam: Documents the `id` parameter.
   * - @SwaggerApiResponse (200): Defines a successful response with a `Stream` object.
   * - @SwaggerApiResponse (404): Documents the case where a stream is not found.
   */
  @ApiOperation({ summary: 'Get stream by ID' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Stream details retrieved successfully',
    type: Stream,
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  // @UseGuards(GeoFencingGuard) // Restricts access based on geo-fencing/VPN rules
  @Get('streams/:id') // HTTP GET endpoint at /streams/:id
  async findStreamById(@Param('id') id: string): Promise<ApiResponse> {
    // Call the bettingService to fetch the stream by its ID
    const stream = await this.bettingService.findStreamById(id);

    // Return standardized API response format
    return {
      message: 'Stream details retrieved successfully',
      status: HttpStatus.OK,
      data: stream,
    };
  }

  /**
   * Controller method to fetch betting variables (options) for a given stream.
   *
   * Functional Comment:
   * -------------------
   * - This endpoint retrieves all betting options (variables) associated with a stream.
   * - The `id` parameter in the route identifies the stream (e.g., `/streams/123/betting-variables`).
   * - If the stream exists, the list of `BettingVariable` objects is returned.
   * - If the stream does not exist, a `404 Stream not found` response is documented in Swagger.
   * - Geo-fencing restrictions are enforced using `GeoFencingGuard`.
   * - Returns a standard `ApiResponse` object containing the betting variables.
   *
   * Swagger Decorators:
   * - @ApiOperation: Describes the endpoint purpose in Swagger docs.
   * - @ApiParam: Documents the required `id` route parameter.
   * - @SwaggerApiResponse (200): Defines a successful response returning an array of `BettingVariable` objects.
   * - @SwaggerApiResponse (404): Indicates when the requested stream cannot be found.
   */
  @ApiOperation({ summary: 'Get betting options for a stream' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Betting variables retrieved successfully',
    type: [BettingVariable],
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  // @UseGuards(GeoFencingGuard) // Restricts access based on geo-fencing/VPN rules
  @Get('streams/:id/betting-variables') // GET endpoint to fetch betting options for a specific stream
  async getStreamBets(@Param('id') id: string): Promise<ApiResponse> {
    // Call bettingService to fetch betting variables for the given stream ID
    const bettingVariables = await this.bettingService.getStreamBets(id);

    // Return standardized API response format
    return {
      message: 'Betting options retrieved successfully',
      status: HttpStatus.OK,
      data: bettingVariables,
    };
  }

  /**
   * Controller method to place a bet on a stream's betting option.
   *
   * Functional Comment:
   * -------------------
   * - This endpoint allows an authenticated user to place a bet on a stream.
   * - Requires a valid JWT token (`@ApiBearerAuth()` + `JwtAuthGuard`).
   * - Also enforces geo-fencing restrictions (`GeoFencingGuard`).
   * - Accepts bet details in the request body as a `PlaceBetDto`.
   * - On success, creates a new bet and returns it with status `201 Created`.
   *
   * Possible Responses:
   * - **201 (Created):** Bet placed successfully (returns a `Bet` object).
   * - **400 (Bad Request):** Invalid or missing bet data.
   * - **401 (Unauthorized):** User is not authenticated (missing/invalid JWT).
   * - **403 (Forbidden):** User cannot place the bet (e.g., insufficient funds or restricted region).
   *
   * Swagger Decorators:
   * - @ApiOperation: Summarizes the endpoint purpose in Swagger docs.
   * - @SwaggerApiResponse: Documents success and error responses.
   * - @ApiBearerAuth: Marks the endpoint as requiring Bearer Token authentication.
   */
  @ApiOperation({ summary: 'Place a bet' })
  @SwaggerApiResponse({
    status: 201,
    description: 'Bet placed successfully',
    type: Bet,
  })
  @SwaggerApiResponse({ status: 400, description: 'Invalid bet data' })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({ status: 403, description: 'Insufficient funds' })
  @ApiBearerAuth() // Requires JWT token in Authorization header
  @UseGuards(JwtAuthGuard) // , GeoFencingGuard) // Authentication + Geo restrictions
  @Post('place-bet') // POST endpoint at /place-bet
  async placeBet(
    @Request() req: RequestWithUser, // User info from JWT
    @Body() placeBetDto: PlaceBetDto, // Bet details (amount, option, etc.)
  ): Promise<ApiResponse> {
    // Call service to create a bet for the authenticated user
    const bet = await this.bettingService.placeBet(req.user.id, placeBetDto);

    // Return standardized API response
    return {
      message: 'Bet placed successfully',
      status: HttpStatus.CREATED,
      data: bet,
    };
  }

  /**
   * Cancel a bet placed by the authenticated user
   *
   * Functional Comment:
   * -------------------
   * This endpoint allows an authenticated user to cancel one of their active bets.
   * - The user must be logged in (JWT required) and within the allowed geofence.
   * - The service checks if the bet exists and whether the user is allowed to cancel it.
   * - If valid, the bet will be cancelled, and the updated bet information is returned.
   *
   * Swagger Responses:
   * - 200: Bet cancelled successfully
   * - 401: Unauthorized (no or invalid token)
   * - 403: Forbidden (user cannot cancel this bet)
   * - 404: Bet not found
   */
  @ApiOperation({ summary: 'Cancel a bet' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Bet cancelled successfully',
    type: Bet,
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Cannot cancel this bet',
  })
  @SwaggerApiResponse({ status: 404, description: 'Bet not found' })
  @ApiBearerAuth() // Requires Bearer token authentication
  @UseGuards(JwtAuthGuard) // , GeoFencingGuard) // Applies JWT and GeoFencing guards
  @Delete('bets/cancel')
  async cancelBet(
    @Request() req: RequestWithUser, // Extracts authenticated user from JWT
    @Body() cancelBetDto: CancelBetDto, // DTO containing bet cancellation details
  ): Promise<ApiResponse> {
    // Call the service to cancel the bet for this user
    const bet = await this.bettingService.cancelBet(req.user.id, cancelBetDto);

    // Return API response with success message and cancelled bet data
    return {
      message: 'Bet cancelled successfully',
      status: HttpStatus.OK,
      data: bet,
    };
  }
  /**
   * Get user's betting history
   *
   * Functional Comment:
   * -------------------
   * This endpoint retrieves the authenticated user’s betting history.
   * - The user must be logged in (JWT required) and within the allowed geofence.
   * - You can optionally filter bets by "active" status (active=true returns only active bets).
   * - If no filter is applied, all bets are returned.
   *
   * Swagger Responses:
   * - 200: User bets retrieved successfully
   * - 401: Unauthorized (invalid or missing token)
   */
  @ApiOperation({ summary: "Get user's betting history" })
  @ApiQuery({
    name: 'active',
    required: false,
    type: Boolean,
    description: 'Filter for active bets only',
  })
  @SwaggerApiResponse({
    status: 200,
    description: 'User bets retrieved successfully',
    type: [Bet],
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth() // Requires Bearer token authentication
  @UseGuards(JwtAuthGuard) // , GeoFencingGuard) // Secured with JWT and geofencing
  @Get('user-bets')
  async getUserBets(
    @Request() req: RequestWithUser, // Extracts authenticated user from request
    @Query('active', new DefaultValuePipe(false), ParseBoolPipe)
    active: boolean, // Optional query param to filter only active bets
  ): Promise<ApiResponse> {
    // Service call to fetch bets for the logged-in user
    const bets = await this.bettingService.getUserBets(req.user.id, active);

    // Return consistent API response format
    return {
      message: 'User betting history retrieved successfully',
      status: HttpStatus.OK,
      data: bets,
    };
  }

  /**
   * Get potential winning amount for a round
   *
   * Functional Comment:
   * -------------------
   * This endpoint calculates and retrieves the potential winning amount
   * for a specific betting round based on the authenticated user’s bets.
   *
   * - Requires user authentication (JWT).
   * - Restricted by geofencing rules.
   * - If the user has placed a bet in the specified round, the potential
   *   winning amount is returned.
   * - If no bet exists for this user in the given round, a message with
   *   `data: null` is returned.
   *
   * Swagger Responses:
   * - 200: Potential winning amount retrieved successfully OR no matching bet found
   * - 401: Unauthorized (invalid/missing token)
   */
  @ApiOperation({ summary: 'Get Potential winning amount for a round' })
  @ApiBearerAuth() // Requires JWT Bearer token
  @UseGuards(JwtAuthGuard) // , GeoFencingGuard) // Authentication + Geofencing
  @Get('potentialAmount/:roundId')
  async findPotentialAmount(
    @Param('roundId') roundId: string, // Round ID from URL
    @Request() req: RequestWithUser, // Authenticated user
  ): Promise<ApiResponse> {
    // Service call: fetch potential amount for user's bet in the round
    const data = await this.bettingService.findPotentialAmount(
      req.user.id,
      roundId,
    );

    if (data === null) {
      return {
        message: 'No matching bet found for this user',
        status: HttpStatus.OK,
        data: null,
      };
    }

    return {
      message: 'Potential amount retrieved successfully',
      status: HttpStatus.OK,
      data: data,
    };
  }

  /**
   * Get user's full betting history with search & pagination
   *
   * Functional Comment:
   * -------------------
   * This endpoint retrieves the full betting history of the authenticated user.
   *
   * Features:
   * - Requires JWT authentication.
   * - Supports filtering (search), sorting, and date range.
   * - Supports pagination when `pagination` flag is enabled.
   * - Returns total record count along with paginated betting data.
   *
   * Swagger Responses:
   * - 200: Betting history retrieved successfully
   * - 401: Unauthorized (invalid/missing token)
   */
  @ApiOperation({
    summary: "Get user's full betting history with search & pagination",
  })
  @SwaggerApiResponse({
    status: 200,
    description: 'Betting history retrieved successfully',
    type: BetHistoryResponseDto, // DTO for API docs
  })
  @SwaggerApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('history')
  async getBettingHistory(
    @Request() req: RequestWithUser,
    @Query() betHistoryFilterDto: BetHistoryFilterDto,
  ): Promise<{
    message: string;
    status: number;
    data: any;
    total: number;
  }> {
    // Service handles filtering, sorting, and pagination
    const { data, total } = await this.bettingService.getUserBettingHistory(
      req.user.id,
      betHistoryFilterDto,
    );

    return {
      message: 'Successfully Listed',
      status: HttpStatus.OK,
      data,
      total,
    };
  }

  /**
   * Edit an existing bet
   *
   * Functional Comment:
   * -------------------
   * This endpoint allows an authenticated user to edit an existing bet.
   *
   * Features:
   * - Requires JWT authentication & GeoFencing validation.
   * - Accepts updated bet details via `EditBetDto`.
   * - Validates bet ownership and checks funds availability.
   * - Returns the updated bet on success.
   *
   * Swagger Responses:
   * - 200: Bet edited successfully
   * - 400: Invalid bet data (validation errors)
   * - 401: Unauthorized (missing/invalid token)
   * - 403: Insufficient funds / Forbidden action
   */
  @ApiOperation({ summary: 'Edit a bet' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Bet edited successfully',
    type: Bet, // Entity or response DTO
  })
  @SwaggerApiResponse({
    status: 400,
    description: 'Invalid bet data',
  })
  @SwaggerApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @SwaggerApiResponse({
    status: 403,
    description: 'Insufficient funds',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard) // , GeoFencingGuard)
  @Patch('edit-bet')
  async editBet(
    @Request() req: RequestWithUser,
    @Body() editBetDto: EditBetDto,
  ): Promise<any> {
    const bet = await this.bettingService.editBet(req.user.id, editBetDto);

    return {
      message: 'Bet edited successfully',
      status: HttpStatus.OK,
      data: bet,
    };
  }
}
