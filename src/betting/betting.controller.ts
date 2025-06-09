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
} from '@nestjs/common';
import { BettingService } from './betting.service';
import { PlaceBetDto } from './dto/place-bet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Stream } from './entities/stream.entity';
import { BettingVariable } from './entities/betting-variable.entity';
import { Bet } from './entities/bet.entity';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

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
  @ApiResponse({
    status: 200,
    description: 'List of streams retrieved successfully',
    type: [Stream],
  })
  @Get('streams')
  async findAllStreams(
    @Query('includeEnded', new DefaultValuePipe(false), ParseBoolPipe)
    includeEnded: boolean,
  ): Promise<Stream[]> {
    return this.bettingService.findAllStreams(includeEnded);
  }

  @ApiOperation({ summary: 'Get stream by ID' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @ApiResponse({
    status: 200,
    description: 'Stream details retrieved successfully',
    type: Stream,
  })
  @ApiResponse({ status: 404, description: 'Stream not found' })
  @Get('streams/:id')
  async findStreamById(@Param('id') id: string): Promise<Stream> {
    return this.bettingService.findStreamById(id);
  }

  @ApiOperation({ summary: 'Get betting options for a stream' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @ApiResponse({
    status: 200,
    description: 'Betting variables retrieved successfully',
    type: [BettingVariable],
  })
  @ApiResponse({ status: 404, description: 'Stream not found' })
  @Get('streams/:id/betting-variables')
  async getStreamBets(@Param('id') id: string): Promise<BettingVariable[]> {
    return this.bettingService.getStreamBets(id);
  }

  @ApiOperation({ summary: 'Place a bet' })
  @ApiResponse({
    status: 201,
    description: 'Bet placed successfully',
    type: Bet,
  })
  @ApiResponse({ status: 400, description: 'Invalid bet data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient funds' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('place-bet')
  async placeBet(
    @Request() req: RequestWithUser,
    @Body() placeBetDto: PlaceBetDto,
  ): Promise<Bet> {
    return this.bettingService.placeBet(req.user.id, placeBetDto);
  }

  @ApiOperation({ summary: 'Cancel a bet' })
  @ApiParam({ name: 'id', description: 'Bet ID' })
  @ApiResponse({
    status: 200,
    description: 'Bet cancelled successfully',
    type: Bet,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Cannot cancel this bet',
  })
  @ApiResponse({ status: 404, description: 'Bet not found' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('bets/:id')
  async cancelBet(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<Bet> {
    return this.bettingService.cancelBet(req.user.id, id);
  }

  @ApiOperation({ summary: "Get user's betting history" })
  @ApiQuery({
    name: 'active',
    required: false,
    type: Boolean,
    description: 'Filter for active bets only',
  })
  @ApiResponse({
    status: 200,
    description: 'User bets retrieved successfully',
    type: [Bet],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('user-bets')
  async getUserBets(
    @Request() req: RequestWithUser,
    @Query('active', new DefaultValuePipe(false), ParseBoolPipe)
    active: boolean,
  ): Promise<Bet[]> {
    return this.bettingService.getUserBets(req.user.id, active);
  }
}
