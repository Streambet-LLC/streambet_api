import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  UseGuards,
  Request,
  Headers,
  Req,
  RawBodyRequest,
  BadRequestException,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiQuery,
} from '@nestjs/swagger';
import { CoinflowWebhookGuard } from '../auth/guards/coinflow-webhook.guard';
import { CoinflowWebhookDto } from './dto/coinflow-webhook.dto';
import { CoinflowWithdrawDto, CoinflowWithdrawKycDto, CoinflowWithdrawKycUsDto } from './dto/coinflow-withdraw.dto';
import { Response } from 'express';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiOperation({ summary: 'Create a Stripe checkout session' })
  @ApiBody({
    schema: {
      properties: {
        packageId: {
          type: 'string',
          description: 'Gold Coin package ID to purchase',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Checkout session created successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid package ID' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('create-checkout-session')
  async createCheckoutSession(
    @Request() req: RequestWithUser,
    @Body('packageId') packageId: string,
  ) {
    return this.paymentsService.createCheckoutSession(req.user.id, packageId);
  }

  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  @ApiHeader({
    name: 'stripe-signature',
    description: 'Stripe webhook signature',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook event processed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Missing or invalid data',
  })
  @Post('webhook')
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException('Missing request body');
    }
    return this.paymentsService.handleWebhookEvent(signature, request.rawBody);
  }

  @ApiOperation({ summary: 'Set up auto-reload for betting' })
  @ApiBody({
    schema: {
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to reload when balance is low',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Auto-reload session created successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('auto-reload')
  async createAutoReloadSession(
    @Request() req: RequestWithUser,
    @Body('amount') amount: number,
  ) {
    return this.paymentsService.createAutoReloadSession(req.user.id, amount);
  }

  @ApiOperation({ summary: 'Confirm auto-reload payment' })
  @ApiBody({
    schema: {
      properties: {
        paymentIntentId: {
          type: 'string',
          description: 'Stripe Payment Intent ID',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Auto-reload confirmed successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid payment intent',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('confirm-auto-reload')
  async confirmAutoReload(@Body('paymentIntentId') paymentIntentId: string) {
    return this.paymentsService.handleAutoReloadSuccess(paymentIntentId);
  }

  /** Retrieves a Coinflow session key for the authenticated user. */
  @ApiOperation({ summary: 'Get Coinflow session key' })
  @ApiResponse({ status: 200, description: 'Coinflow session key fetched' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('coinflow/session-key')
  async getCoinflowSessionKey(@Request() req: RequestWithUser) {
    return this.paymentsService.getCoinflowSessionKey(req.user.id);
  }

  /** Retrieves Coinflow withdrawer data for the authenticated user. */
  @ApiOperation({ summary: 'Get Coinflow withdraw' })
  @ApiResponse({
    status: 200,
    description: 'Coinflow withdraw payload fetched',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 402, description: 'User not registered as withdrawer in coinflow' })
  @ApiResponse({ status: 451, description: 'User must complete additional verification' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('coinflow/withdrawer')
  async getCoinflowWithdraw(
    @Request() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
    @Query('redirectLink') redirectLink: string,
  ) {
    const result = await this.paymentsService.getCoinflowWithdraw(req.user.id, redirectLink);

    if (result.status === 451) {
      res.status(451);
      return result.data;
    }

    return result;
  }

  /** Retrieves Coinflow withdraw quote for the authenticated user. */
  @ApiOperation({ summary: 'Get Coinflow withdraw quote' })
  @ApiResponse({ status: 200, description: 'Coinflow withdraw quote fetched' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid amount' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiQuery({ name: 'amount', type: Number, required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('coinflow/withdrawer/quote')
  async getCoinflowWithdrawQuote(
    @Request() req: RequestWithUser,
    @Query('amount') amount: string,
  ) {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('Invalid amount');
    }
    return this.paymentsService.getCoinflowWithdrawQuote(
      parsedAmount,
      req.user.id,
    );
  }

  /** Deletes a Coinflow withdrawer bank account for the authenticated user. */
  @ApiOperation({ summary: 'Delete Coinflow withdrawer bank account' })
  @ApiResponse({ status: 200, description: 'Coinflow withdrawer account deleted' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid token' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiQuery({ name: 'token', type: String, required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('coinflow/delete-withdrawer-account')
  async deleteCoinflowWithdrawerAccount(
    @Request() req: RequestWithUser,
    @Query('token') token: string,
  ) {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new BadRequestException('Missing or invalid token');
    }
    return this.paymentsService.deleteCoinflowWithdrawerAccount(
      token,
      req.user.id,
    );
  }

  /** Initiates a delegated payout (withdrawal) to the authenticated user's account via Coinflow. */
  @ApiOperation({ summary: 'Initiate Coinflow delegated payout (withdrawal)' })
  @ApiResponse({ status: 201, description: 'Withdrawal initiated' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid amount/coins' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('coinflow/withdraw')
  async initiateCoinflowWithdraw(
    @Request() req: RequestWithUser,
    @Body() body: CoinflowWithdrawDto,
  ) {
    return this.paymentsService.initiateCoinflowDelegatedPayout(req.user.id, {
      coins: body.coins,
      account: body.account,
      speed: body.speed,
    });
  }

  /** Registers non-US user in Coinflow as a withdrawer for payout. */
  @ApiOperation({ summary: 'Registers non-US user in Coinflow as a withdrawer for payout.' })
  @ApiResponse({ status: 200, description: 'User registered as withdrawer' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 451, description: 'User must complete additional verification' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('coinflow/withdraw/kyc')
  async kyc(
    @Request() req: RequestWithUser,
    @Body() body: CoinflowWithdrawKycDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.paymentsService.registerUserKyc(req.user.id, body);

    if (result.status === 451) {
      res.status(451);
      return result.data;
    }

    return result;
  }

  /** Registers US-based user in Coinflow as a withdrawer for payout. */
  @ApiOperation({ summary: 'Registers US-based user in Coinflow as a withdrawer for payout.' })
  @ApiResponse({ status: 200, description: 'User registered as withdrawer' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 451, description: 'User must complete additional verification' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('coinflow/withdraw/kyc-us')
  async kycUs(
    @Request() req: RequestWithUser,
    @Body() body: CoinflowWithdrawKycUsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.paymentsService.registerUserKycUs(req.user.id, body);

    if (result.status === 451) {
      res.status(451);
      return result.data;
    }

    return result;
  }
}
