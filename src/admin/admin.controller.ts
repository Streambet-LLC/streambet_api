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
} from '@nestjs/common';
import { BettingService } from '../betting/betting.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User, UserRole } from '../users/entities/user.entity';
import { CreateStreamDto } from '../betting/dto/create-stream.dto';
import { CreateBettingVariableDto } from '../betting/dto/create-betting-variable.dto';
import { StreamStatus } from '../betting/entities/stream.entity';
import { BettingVariableStatus } from '../betting/entities/betting-variable.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiOkResponse,
} from '@nestjs/swagger';
import { UserFilterDto } from 'src/users/dto/user.requests.dto';

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
  ) {}

  // Helper method to check if user is admin
  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  // Stream Management
  @ApiOperation({ summary: 'Create a new stream' })
  @ApiResponse({ status: 201, description: 'Stream created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @Post('streams')
  async createStream(
    @Request() req: RequestWithUser,
    @Body() createStreamDto: CreateStreamDto,
  ) {
    this.ensureAdmin(req.user);
    return this.bettingService.createStream(createStreamDto);
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
  @ApiResponse({
    status: 200,
    description: 'Stream status updated successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @ApiResponse({ status: 404, description: 'Stream not found' })
  @Patch('streams/:id/status')
  async updateStreamStatus(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body('status') status: StreamStatus,
  ) {
    this.ensureAdmin(req.user);
    return this.bettingService.updateStreamStatus(id, status);
  }

  // Betting Variable Management
  @ApiOperation({ summary: 'Create betting options' })
  @ApiResponse({
    status: 201,
    description: 'Betting variable created successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @ApiResponse({ status: 404, description: 'Stream not found' })
  @Post('betting-variables')
  async createBettingVariable(
    @Request() req: RequestWithUser,
    @Body() createBettingVariableDto: CreateBettingVariableDto,
  ) {
    this.ensureAdmin(req.user);
    return this.bettingService.createBettingVariable(createBettingVariableDto);
  }

  @ApiOperation({ summary: 'Lock betting' })
  @ApiParam({ name: 'id', description: 'Betting variable ID' })
  @ApiResponse({ status: 200, description: 'Betting locked successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @ApiResponse({ status: 404, description: 'Betting variable not found' })
  @Patch('betting-variables/:id/lock')
  async lockBetting(@Request() req: RequestWithUser, @Param('id') id: string) {
    this.ensureAdmin(req.user);
    return this.bettingService.updateBettingVariableStatus(
      id,
      BettingVariableStatus.LOCKED,
    );
  }

  @ApiOperation({ summary: 'Declare a winner' })
  @ApiParam({ name: 'id', description: 'Betting variable ID' })
  @ApiResponse({
    status: 200,
    description: 'Winner declared and payouts processed successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @ApiResponse({ status: 404, description: 'Betting variable not found' })
  @Post('betting-variables/:id/declare-winner')
  async declareWinner(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    this.ensureAdmin(req.user);
    return this.bettingService.declareWinner(req.user.id, id, req.user);
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
  @ApiResponse({
    status: 200,
    description: 'Wallet balance adjusted successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  @Patch('users/:id/wallet')
  async adjustWallet(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body('amount') amount: number,
    @Body('description') description: string,
  ) {
    this.ensureAdmin(req.user);
    return this.walletsService.addFreeTokens(id, amount, description);
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
}
