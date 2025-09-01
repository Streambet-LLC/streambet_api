import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  HttpStatus,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { TransactionFilterDto } from './dto/transaction.list.dto';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('wallets')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  /**
   * getBalance - API endpoint to fetch the user's wallet balance.
   *
   * - Returns the wallet entity.
   */
  @ApiOperation({ summary: "Get user's wallet balance" })
  @ApiResponse({
    status: 200,
    description: 'Wallet details retrieved successfully',
    type: Wallet,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('balance')
  async getBalance(@Request() req: RequestWithUser): Promise<Wallet> {
    return this.walletsService.findByUserId(req.user.id);
  }

  /**
   * getTransactions - API endpoint to retrieve a user's transaction history.
   *
   * - Returns transaction list with total count.
   */
  @ApiOperation({ summary: "Get user's transaction history" })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 200,
    description: 'Transaction history retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Successfully Listed' },
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/Transaction' },
        },
        total: { type: 'number', example: 100 },
      },
    },
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('transactions')
  async getTransactions(
    @Request() req: RequestWithUser,
    @Query() transactionFilterDto: TransactionFilterDto,
  ) {
    const { data, total } = await this.walletsService.getAllTransactionHistory(
      transactionFilterDto,
      req.user.id,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
      total,
    };
  }
}
