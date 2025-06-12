import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Headers,
  Req,
  RawBodyRequest,
  BadRequestException,
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
} from '@nestjs/swagger';

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
          description: 'Token package ID to purchase',
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
}
