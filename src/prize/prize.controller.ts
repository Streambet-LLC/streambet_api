import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PrizeService } from './prize.service';
import {
  PrizeConfigurationDto,
  CreatePrizeTierDto,
  UpdatePrizeTierDto,
  AdminRedemptionResponseDto,
  UpdateRedemptionStatusDto,
  SubmitPrizeRedemptionDto,
  UserRedemptionResponseDto,
  CreatePrizeOrderDto,
  PrizeOrderResponseDto,
  MakeOfferDto,
  CounterOfferDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { UserRole } from 'src/enums/user-role.enum';

interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('prizes')
@Controller('prizes')
export class PrizeController {
  constructor(private readonly prizeService: PrizeService) {}

  /**
   * Public endpoint: Get all active prize tiers
   * Used by frontend to display prize tiers and images
   */
  @Get('config')
  @ApiOperation({ summary: 'Get all active prize tiers (public)' })
  @ApiResponse({
    status: 200,
    description: 'Returns all active prize tiers',
    type: [PrizeConfigurationDto],
  })
  @ApiResponse({ status: 404, description: 'No active tiers found' })
  async getPrizeConfiguration(): Promise<PrizeConfigurationDto[]> {
    return this.prizeService.getPrizeConfiguration();
  }

  @Get('shops')
  @ApiOperation({ summary: 'Get seller shops with active inventory' })
  @ApiResponse({ status: 200, description: 'Returns seller shops' })
  async getSellerShops() {
    return this.prizeService.getSellerShops();
  }

  @Get('shops/:username/items')
  @ApiOperation({ summary: 'Get a seller shop and its active items' })
  @ApiParam({ name: 'username', description: 'Seller username' })
  @ApiResponse({
    status: 200,
    description: 'Returns seller shop details and items',
  })
  @ApiResponse({ status: 404, description: 'Seller shop not found' })
  async getShopItemsByUsername(@Param('username') username: string) {
    return this.prizeService.getPublicShopByUsername(username);
  }

  /**
   * User endpoint: Submit prize redemption
   */
  @Post('redeem')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit prize redemption with shipping address' })
  @ApiResponse({
    status: 201,
    description: 'Prize redemption submitted successfully',
    type: UserRedemptionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Prize tier already redeemed' })
  async submitRedemption(
    @Request() req: RequestWithUser,
    @Body() dto: SubmitPrizeRedemptionDto,
  ): Promise<UserRedemptionResponseDto> {
    return this.prizeService.redeemPrize(req.user.id, dto);
  }

  /**
   * User endpoint: Get my redemptions
   */
  @Get('my-redemptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user redemptions' })
  @ApiResponse({
    status: 200,
    description: 'Returns user redemptions',
    type: [UserRedemptionResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyRedemptions(
    @Request() req: RequestWithUser,
  ): Promise<UserRedemptionResponseDto[]> {
    return this.prizeService.getUserRedemptions(req.user.id);
  }

  /**
   * User endpoint: Create a prize order (combined payment: coins + USD)
   * 100 Cade coins = $1
   */
  @Post('purchase')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a prize purchase order with combined payment',
    description:
      'Users can pay with coins only, USD only, or a combination. 50 Cade coins = $1',
  })
  @ApiResponse({
    status: 201,
    description: 'Prize order created successfully',
    type: 'object',
    schema: {
      properties: {
        order: { type: 'object' },
        stripeSessionUrl: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid order data or insufficient balance',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Prize not found' })
  async createPrizeOrder(
    @Request() req: RequestWithUser,
    @Body() dto: CreatePrizeOrderDto,
  ) {
    return this.prizeService.createPrizeOrder(req.user.id, dto);
  }

  /**
   * User endpoint: Get my orders
   */
  @Get('my-orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user prize orders' })
  @ApiResponse({
    status: 200,
    description: 'Returns user prize orders',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyOrders(@Request() req: RequestWithUser) {
    return this.prizeService.getUserOrders(req.user.id);
  }

  /**
   * Webhook: Handle Stripe payment success for prize orders
   */
  @Post('webhook/stripe-success/:orderId')
  @ApiOperation({ summary: 'Webhook handler for Stripe payment success' })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({
    status: 200,
    description: 'Payment processed successfully',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async handleStripeSuccess(@Param('orderId') orderId: string) {
    return this.prizeService.handlePaymentSuccess(orderId);
  }

  /**
   * User endpoint: Make an offer on a prize
   */
  @Post('make-offer')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Make an offer on a prize item' })
  @ApiResponse({
    status: 201,
    description: 'Offer submitted successfully',
    type: PrizeOrderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid offer data' })
  @ApiResponse({ status: 404, description: 'Prize not found' })
  async makeOffer(
    @Request() req: RequestWithUser,
    @Body() dto: MakeOfferDto,
  ): Promise<PrizeOrderResponseDto> {
    return this.prizeService.makeOffer(req.user.id, dto);
  }

  /**
   * User endpoint: Accept a counter offer
   */
  @Post('orders/:orderId/accept-counter')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept a counter offer on your order' })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({
    status: 200,
    description: 'Counter offer accepted, Stripe checkout URL returned',
  })
  @ApiResponse({ status: 400, description: 'No counter offer to accept' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async acceptCounterOffer(
    @Request() req: RequestWithUser,
    @Param('orderId') orderId: string,
  ) {
    return this.prizeService.acceptCounterOffer(orderId);
  }
}

@ApiTags('admin-prizes')
@ApiBearerAuth()
@Controller('admin/prizes')
@UseGuards(JwtAuthGuard)
export class AdminPrizeController {
  constructor(private readonly prizeService: PrizeService) {}

  /**
   * Helper method to check if user is admin
   */
  private ensureAdmin(user: User): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  /**
   * Admin endpoint: Get all active prize tiers
   */
  @Get()
  @ApiOperation({ summary: 'Get all active prize tiers (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Returns all active prize tiers',
    type: [PrizeConfigurationDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'No active tiers found' })
  async getActivePrizeTiers(
    @Request() req: RequestWithUser,
  ): Promise<PrizeConfigurationDto[]> {
    this.ensureAdmin(req.user);
    return this.prizeService.getAdminActivePrizeConfigurations();
  }

  /**
   * Admin endpoint: Create new prize tier
   */
  @Post()
  @ApiOperation({ summary: 'Create new prize tier (admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Prize tier created successfully',
    type: PrizeConfigurationDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid prize tier data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 409, description: 'Prize tier already exists' })
  async createPrizeTier(
    @Request() req: RequestWithUser,
    @Body() dto: CreatePrizeTierDto,
  ): Promise<PrizeConfigurationDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.createPrizeTier(dto, req.user.id);
  }

  /**
   * Admin endpoint: Update prize tier
   * Implements data hardening: deactivates old tier and creates new one
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update prize tier (admin only)' })
  @ApiParam({ name: 'id', description: 'Prize tier ID' })
  @ApiResponse({
    status: 200,
    description:
      'Prize tier updated successfully (old tier deactivated, new one created)',
    type: PrizeConfigurationDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid prize tier data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Prize tier not found' })
  async updatePrizeTier(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdatePrizeTierDto,
  ): Promise<PrizeConfigurationDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.updatePrizeTier(id, dto, req.user.id);
  }

  /**
   * Admin endpoint: Delete (soft delete) prize tier
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete prize tier (admin only)' })
  @ApiParam({ name: 'id', description: 'Prize tier ID' })
  @ApiResponse({
    status: 200,
    description: 'Prize tier deactivated successfully',
  })
  @ApiResponse({ status: 400, description: 'Prize tier already inactive' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Prize tier not found' })
  async deletePrizeTier(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    this.ensureAdmin(req.user);
    await this.prizeService.deletePrizeTier(id);
    return { message: 'Prize tier deactivated successfully' };
  }

  /**
   * Admin endpoint: Get all prize tiers (including inactive, for history/audit)
   */
  @Get('history')
  @ApiOperation({
    summary: 'Get all prize tiers including inactive (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns all prize tiers',
    type: [PrizeConfigurationDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async getAllConfigurations(
    @Request() req: RequestWithUser,
  ): Promise<PrizeConfigurationDto[]> {
    this.ensureAdmin(req.user);
    return this.prizeService.getAllConfigurations();
  }

  /**
   * Admin endpoint: Get all prize redemptions with filters
   */
  @Get('redemptions')
  @ApiOperation({
    summary: 'Get all prize redemptions with optional filters (admin only)',
    description:
      'Returns paginated list of prize redemptions with filtering support',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated prize redemptions',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/AdminRedemptionResponseDto' },
        },
        total: { type: 'number', example: 5, description: 'Total pages' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async getRedemptions(
    @Request() req: RequestWithUser,
    @Query() filterDto: { range?: string; status?: string },
  ) {
    this.ensureAdmin(req.user);
    return this.prizeService.getAdminRedemptions(filterDto);
  }

  /**
   * Admin endpoint: Get a single redemption by ID
   */
  @Get('redemptions/:id')
  @ApiOperation({ summary: 'Get a single prize redemption by ID (admin only)' })
  @ApiParam({ name: 'id', description: 'Redemption ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the redemption details',
    type: AdminRedemptionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Redemption not found' })
  async getRedemptionById(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<AdminRedemptionResponseDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.getAdminRedemptionById(id);
  }

  /**
   * Admin endpoint: Update redemption status and tracking information
   */
  @Patch('redemptions/:id/status')
  @ApiOperation({
    summary: 'Update redemption status and tracking info (admin only)',
  })
  @ApiParam({ name: 'id', description: 'Redemption ID' })
  @ApiResponse({
    status: 200,
    description: 'Redemption status updated successfully',
    type: AdminRedemptionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid status or missing tracking info',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Redemption not found' })
  async updateRedemptionStatus(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateRedemptionStatusDto,
  ): Promise<AdminRedemptionResponseDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.updateRedemptionStatus(id, dto);
  }

  /**
   * Admin endpoint: Get all prize orders
   */
  @Get('orders')
  @ApiOperation({
    summary: 'Get all prize orders with optional filters (admin only)',
    description: 'Returns paginated list of prize orders',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated prize orders',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async getOrders(
    @Request() req: RequestWithUser,
    @Query() filterDto: { range?: string; status?: string },
  ) {
    this.ensureAdmin(req.user);
    return this.prizeService.getAllOrders(filterDto);
  }

  /**
   * Admin endpoint: Get a single order by ID
   */
  @Get('orders/:id')
  @ApiOperation({ summary: 'Get a single prize order by ID (admin only)' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the order details',
    type: PrizeOrderResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrderById(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<PrizeOrderResponseDto> {
    this.ensureAdmin(req.user);
    const order = await this.prizeService.getPrizeOrderById(id);
    return this.mapOrderToDto(order);
  }

  /**
   * Admin endpoint: Update order status
   */
  @Patch('orders/:id/status')
  @ApiOperation({ summary: 'Update prize order status (admin only)' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({
    status: 200,
    description: 'Order status updated successfully',
    type: PrizeOrderResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async updateOrderStatus(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body('status')
    status:
      | 'pending'
      | 'buy_attempted'
      | 'paid'
      | 'processing'
      | 'shipped'
      | 'delivered'
      | 'cancelled',
  ): Promise<PrizeOrderResponseDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.updateOrderStatus(id, status);
  }

  /**
   * Admin endpoint: Counter offer on a user's offer
   */
  @Patch('orders/:orderId/counter')
  @ApiOperation({ summary: 'Make a counter offer (admin only)' })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({
    status: 200,
    description: 'Counter offer sent successfully',
    type: PrizeOrderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid counter offer' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async counterOffer(
    @Request() req: RequestWithUser,
    @Param('orderId') orderId: string,
    @Body() dto: CounterOfferDto,
  ): Promise<PrizeOrderResponseDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.counterOffer(orderId, dto);
  }

  /**
   * Admin endpoint: Accept a user's offer
   */
  @Patch('orders/:orderId/accept-offer')
  @ApiOperation({ summary: 'Accept an offer (admin only)' })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({
    status: 200,
    description: 'Offer accepted, checkout link sent to user',
    type: PrizeOrderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Cannot accept this offer' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async acceptOffer(
    @Request() req: RequestWithUser,
    @Param('orderId') orderId: string,
  ): Promise<PrizeOrderResponseDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.acceptOffer(orderId);
  }

  /**
   * Admin endpoint: Reject a user's offer
   */
  @Patch('orders/:orderId/reject-offer')
  @ApiOperation({ summary: 'Reject an offer (admin only)' })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({
    status: 200,
    description: 'Offer rejected successfully',
    type: PrizeOrderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Cannot reject this offer' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async rejectOffer(
    @Request() req: RequestWithUser,
    @Param('orderId') orderId: string,
  ): Promise<PrizeOrderResponseDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.rejectOffer(orderId);
  }

  /**
   * Helper to map order to DTO (needed in controller for response typing)
   */
  private mapOrderToDto(order: any) {
    return {
      id: order.id,
      userId: order.userId,
      prizeConfigId: order.prizeConfigurationId,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod,
      coinsDeducted: order.coinsDeducted,
      usdCharged: parseFloat(order.usdCharged?.toString() || '0'),
      totalPrice: parseFloat(order.totalPrice?.toString() || '0'),
      stripeSessionId: order.stripeSessionId,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}

@ApiTags('seller-prizes')
@ApiBearerAuth()
@Controller('seller/prizes')
@UseGuards(JwtAuthGuard)
export class SellerPrizeController {
  constructor(private readonly prizeService: PrizeService) {}

  private ensureSeller(user: User): void {
    if (!user.isSeller) {
      throw new ForbiddenException('Seller access required');
    }
  }

  @Get('items')
  @ApiOperation({ summary: 'Get my seller shop items' })
  @ApiResponse({ status: 200, type: [PrizeConfigurationDto] })
  async getMyShopItems(
    @Request() req: RequestWithUser,
  ): Promise<PrizeConfigurationDto[]> {
    this.ensureSeller(req.user);
    return this.prizeService.getMySellerShopItems(req.user.id);
  }

  @Post('items')
  @ApiOperation({ summary: 'Create a seller shop item' })
  @ApiResponse({ status: 201, type: PrizeConfigurationDto })
  async createShopItem(
    @Request() req: RequestWithUser,
    @Body() dto: CreatePrizeTierDto,
  ): Promise<PrizeConfigurationDto> {
    this.ensureSeller(req.user);
    return this.prizeService.createMySellerShopItem(req.user.id, dto);
  }

  @Put('items/:id')
  @ApiOperation({ summary: 'Update a seller shop item' })
  @ApiParam({ name: 'id', description: 'Shop item ID' })
  @ApiResponse({ status: 200, type: PrizeConfigurationDto })
  async updateShopItem(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdatePrizeTierDto,
  ): Promise<PrizeConfigurationDto> {
    this.ensureSeller(req.user);
    return this.prizeService.updateMySellerShopItem(req.user.id, id, dto);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Delete a seller shop item' })
  @ApiParam({ name: 'id', description: 'Shop item ID' })
  @ApiResponse({ status: 200, description: 'Shop item deleted' })
  async deleteShopItem(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    this.ensureSeller(req.user);
    await this.prizeService.deleteMySellerShopItem(req.user.id, id);
    return { message: 'Shop item deleted successfully' };
  }

  @Get('offers')
  @ApiOperation({ summary: 'Get offers for my shop items' })
  @ApiResponse({ status: 200, description: 'Returns seller shop offers' })
  async getMyShopOffers(
    @Request() req: RequestWithUser,
    @Query() filterDto: { range?: string; status?: string },
  ) {
    this.ensureSeller(req.user);
    return this.prizeService.getSellerOffers(req.user.id, filterDto);
  }

  @Patch('offers/:orderId/counter')
  @ApiOperation({ summary: 'Counter an offer for my shop item' })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({ status: 200, type: PrizeOrderResponseDto })
  async counterShopOffer(
    @Request() req: RequestWithUser,
    @Param('orderId') orderId: string,
    @Body() dto: CounterOfferDto,
  ): Promise<PrizeOrderResponseDto> {
    this.ensureSeller(req.user);
    return this.prizeService.sellerCounterOffer(req.user.id, orderId, dto);
  }

  @Patch('offers/:orderId/accept-offer')
  @ApiOperation({ summary: 'Accept an offer for my shop item' })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({ status: 200, type: PrizeOrderResponseDto })
  async acceptShopOffer(
    @Request() req: RequestWithUser,
    @Param('orderId') orderId: string,
  ): Promise<PrizeOrderResponseDto> {
    this.ensureSeller(req.user);
    return this.prizeService.sellerAcceptOffer(req.user.id, orderId);
  }

  @Patch('offers/:orderId/reject-offer')
  @ApiOperation({ summary: 'Reject an offer for my shop item' })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({ status: 200, type: PrizeOrderResponseDto })
  async rejectShopOffer(
    @Request() req: RequestWithUser,
    @Param('orderId') orderId: string,
  ): Promise<PrizeOrderResponseDto> {
    this.ensureSeller(req.user);
    return this.prizeService.sellerRejectOffer(req.user.id, orderId);
  }
}
