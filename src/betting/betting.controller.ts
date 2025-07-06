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
import {
  CurrencyTypeDto,
  EditBetDto,
  PlaceBetDto,
  RoundIdDto,
} from './dto/place-bet.dto';
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

// Define ApiResponse
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
  @Delete('bets/cancel')
  async cancelBet(
    @Request() req: RequestWithUser,
    @Body() cancelBetDto: CancelBetDto,
  ) {
    const bet = await this.bettingService.cancelBet(req.user.id, cancelBetDto);
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
  ) {
    const bets = await this.bettingService.getUserBets(req.user.id, active);
    return {
      message: 'User betting history retrieved successfully',
      status: HttpStatus.OK,
      data: bets,
    };
  }

  @ApiOperation({ summary: 'Get Potential winning amount for a round' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('potentialAmount/:roundId')
  async findPotentialAmount(
    @Param('roundId') roundId: string,
    @Request() req: RequestWithUser,
  ) {
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

  @ApiOperation({ summary: 'Edit a bet' })
  @SwaggerApiResponse({
    status: 201,
    description: 'Bet edited successfully',
    type: Bet,
  })
  @SwaggerApiResponse({ status: 400, description: 'Invalid bet data' })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({ status: 403, description: 'Insufficient funds' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('edit-bet')
  async editBet(
    @Request() req: RequestWithUser,
    @Body() editBetDto: EditBetDto,
  ): Promise<ApiResponse> {
    const bet = await this.bettingService.editBet(req.user.id, editBetDto);
    return {
      message: 'Bet edited successfully',
      status: HttpStatus.OK,
      data: bet,
    };
  }
}
