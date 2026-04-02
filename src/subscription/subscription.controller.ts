import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpStatus,
  RawBodyRequest,
  Headers,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/subscription.dto';

interface RequestWithUser extends Request {
  user: { id: string; username: string; email: string; role: string };
}

@ApiTags('Subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a CardCade Pro checkout session' })
  @ApiResponse({ status: 200, description: 'Checkout session created' })
  async createCheckoutSession(
    @Request() req: RequestWithUser,
    @Body() dto: CreateSubscriptionDto,
  ) {
    const result = await this.subscriptionService.createCheckoutSession(
      req.user.id,
      dto.plan,
    );
    return {
      data: result,
      message: 'Checkout session created',
      statusCode: HttpStatus.OK,
    };
  }

  @Patch('upgrade')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upgrade from monthly to yearly plan' })
  @ApiResponse({ status: 200, description: 'Subscription upgraded' })
  async upgradeToYearly(@Request() req: RequestWithUser) {
    const result = await this.subscriptionService.upgradeToYearly(req.user.id);
    return {
      data: result,
      message: 'Subscription upgraded to yearly',
      statusCode: HttpStatus.OK,
    };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current subscription status' })
  @ApiResponse({ status: 200, description: 'Subscription status retrieved' })
  async getSubscriptionStatus(@Request() req: RequestWithUser) {
    const subscription = await this.subscriptionService.getActiveSubscription(
      req.user.id,
    );
    return {
      data: subscription,
      message: subscription
        ? 'Active subscription found'
        : 'No active subscription',
      statusCode: HttpStatus.OK,
    };
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Handle Stripe subscription webhooks' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Request() req: RawBodyRequest<Request>,
  ) {
    const event = this.subscriptionService.verifyWebhookSignature(
      req.rawBody,
      signature,
    );
    await this.subscriptionService.handleSubscriptionWebhook(event);
    return { received: true };
  }
}
