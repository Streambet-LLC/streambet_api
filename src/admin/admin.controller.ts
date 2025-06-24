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
} from '@nestjs/common';
import { BettingService } from '../betting/betting.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User, UserRole } from '../users/entities/user.entity';
import { CreateStreamDto } from '../betting/dto/create-stream.dto';
import { CreateBettingVariableDto } from '../betting/dto/create-betting-variable.dto';

import { BettingVariableStatus } from '../betting/entities/betting-variable.entity';
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

  // Betting Variable Management
  @ApiOperation({ summary: 'Create betting options' })
  @SwaggerApiResponse({
    status: 201,
    description: 'Betting variable created successfully',
  })
  @SwaggerApiResponse({ status: 401, description: 'Unauthorized' })
  @SwaggerApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @SwaggerApiResponse({ status: 404, description: 'Stream not found' })
  @Post('betting-variables')
  async createBettingVariable(
    @Request() req: RequestWithUser,
    @Body() createBettingVariableDto: CreateBettingVariableDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const bettingVariable = await this.bettingService.createBettingVariable(
      createBettingVariableDto,
    );
    return {
      message: 'Betting variable created successfully',
      status: HttpStatus.CREATED,
      data: bettingVariable,
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
    const result = await this.bettingService.declareWinner(
      req.user.id,
      id,
      req.user,
    );
    return {
      message: 'Winner declared and payouts processed successfully',
      status: HttpStatus.OK,
      data: result,
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

  @ApiOperation({
    summary: 'List all the streams in the System',
    description:
      'API to list stream details.Implemented pagenation, range, sort and filter .Pass with parameter false if you want the results without pagination',
  })
  @ApiOkResponse({ type: UserFilterDto })
  @Get('streams')
  async allStremsForAdmin(
    @Request() req: RequestWithUser,
    @Query() streamFilterDto: StreamFilterDto,
  ) {
    this.ensureAdmin(req.user);
    const { total, data } =
      await this.streamService.allStremsForAdmin(streamFilterDto);
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
      total,
    };
  }
}
