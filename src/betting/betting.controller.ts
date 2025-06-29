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
} from '@nestjs/common';
import { BettingService } from './betting.service';
import { PlaceBetDto } from './dto/place-bet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BettingVariable } from './entities/betting-variable.entity';
import { Bet } from './entities/bet.entity';
import { User } from '../users/entities/user.entity';
import { ApiResponse } from '../common/types/api-response.interface';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Stream } from 'src/stream/entities/stream.entity';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('betting')
@Controller('betting')
export class BettingController {
  constructor(private readonly bettingService: BettingService) {}

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
  @Get('streams')
  async findAllStreams(
    @Query('includeEnded', new DefaultValuePipe(false), ParseBoolPipe)
    includeEnded: boolean,
  ): Promise<ApiResponse> {
    const streams = await this.bettingService.findAllStreams(includeEnded);
    return {
      message: 'Streams retrieved successfully',
      status: HttpStatus.OK,
      data: streams,
    };
  }

  @ApiOperation({ summary: 'Get stream by ID' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Stream details retrieved successfully',
    type: Stream,
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Get('streams/:id')
  async findStreamById(@Param('id') id: string): Promise<ApiResponse> {
    const stream = await this.bettingService.findStreamById(id);
    return {
      message: 'Stream details retrieved successfully',
      status: HttpStatus.OK,
      data: stream,
    };
  }

  @ApiOperation({ summary: 'Get betting options for a stream' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Betting variables retrieved successfully',
    type: [BettingVariable],
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Get('streams/:id/betting-variables')
  async getStreamBets(@Param('id') id: string): Promise<ApiResponse> {
    const bettingVariables = await this.bettingService.getStreamBets(id);
    return {
      message: 'Betting options retrieved successfully',
      status: HttpStatus.OK,
      data: bettingVariables,
    };
  }

  @ApiOperation({ summary: 'Get comprehensive betting data for a stream' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @SwaggerApiResponse({
    status: 200,
    description: 'Comprehensive betting data retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        stream: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string' },
            platformName: { type: 'string' },
            viewerCount: { type: 'number' },
            scheduledStartTime: { type: 'string', format: 'date-time' },
            actualStartTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
          },
        },
        summary: {
          type: 'object',
          properties: {
            totalRounds: { type: 'number' },
            totalBettingVariables: { type: 'number' },
            totalBets: { type: 'number' },
            totalBetsAmount: { type: 'number' },
            activeBets: { type: 'number' },
            completedBets: { type: 'number' },
          },
        },
        rounds: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              roundId: { type: 'string' },
              roundName: { type: 'string' },
              freeTokenStatus: { type: 'string' },
              coinStatus: { type: 'string' },
              bettingVariables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    isWinningOption: { type: 'boolean' },
                    status: { type: 'string' },
                    totalBetsTokenAmount: { type: 'number' },
                    totalBetsCoinAmount: { type: 'number' },
                    betCountFreeToken: { type: 'number' },
                    betCountCoin: { type: 'number' },
                    bets: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          userId: { type: 'string' },
                          userName: { type: 'string' },
                          amount: { type: 'number' },
                          currency: { type: 'string' },
                          status: { type: 'string' },
                          payout: { type: 'number' },
                          payoutAmount: { type: 'number' },
                          isProcessed: { type: 'boolean' },
                          processedAt: { type: 'string', format: 'date-time' },
                          createdAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Get('streams/:id/betting-data')
  async getStreamBettingData(@Param('id') id: string): Promise<ApiResponse> {
    const bettingData = await this.bettingService.getStreamBettingData(id);
    return {
      message: 'Comprehensive betting data retrieved successfully',
      status: HttpStatus.OK,
      data: bettingData,
    };
  }

  @ApiOperation({ summary: 'Place a bet' })
  @SwaggerApiResponse({
    status: 201,
    description: 'Bet placed successfully',
    type: Bet,
  })
  @SwaggerApiResponse({ status: 400, description: 'Invalid bet data' })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({ status: 403, description: 'Insufficient funds' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('place-bet')
  async placeBet(
    @Request() req: RequestWithUser,
    @Body() placeBetDto: PlaceBetDto,
  ): Promise<ApiResponse> {
    const bet = await this.bettingService.placeBet(req.user.id, placeBetDto);
    return {
      message: 'Bet placed successfully',
      status: HttpStatus.CREATED,
      data: bet,
    };
  }

  @ApiOperation({ summary: 'Cancel a bet' })
  @ApiParam({ name: 'id', description: 'Bet ID' })
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
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('bets/:id')
  async cancelBet(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    const bet = await this.bettingService.cancelBet(req.user.id, id);
    return {
      message: 'Bet cancelled successfully',
      status: HttpStatus.OK,
      data: bet,
    };
  }

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
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('user-bets')
  async getUserBets(
    @Request() req: RequestWithUser,
    @Query('active', new DefaultValuePipe(false), ParseBoolPipe)
    active: boolean,
  ): Promise<ApiResponse> {
    const bets = await this.bettingService.getUserBets(req.user.id, active);
    return {
      message: 'User betting history retrieved successfully',
      status: HttpStatus.OK,
      data: bets,
    };
  }
}
