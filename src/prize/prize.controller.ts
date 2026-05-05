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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PrizeService } from './prize.service';
import { PrizeEngagementService } from './prize-engagement.service';
import {
  PrizeConfigurationDto,
  EbayMarketSummaryDto,
  EbayMarketHistoryDto,
  AdminEbayMarketSoldListingDto,
  AdminReportedEbaySoldListingDto,
  ModerateEbaySoldListingDto,
  ReportEbaySoldListingDto,
  UpdateItemEbaySearchQueryDto,
  BulkDeleteEbaySoldListingsDto,
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
  MarkAsShippedDto,
  BulkUpdateDisplayOrderDto,
  UpdateShopSettingsDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { UserRole } from 'src/enums/user-role.enum';

interface RequestWithUser extends Request {
  user: User;
}

interface RequestMaybeUser extends Request {
  user?: User;
}

@ApiTags('prizes')
@Controller('prizes')
export class PrizeController {
  constructor(
    private readonly prizeService: PrizeService,
    private readonly engagementService: PrizeEngagementService,
  ) {}

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

  @Get('shop-items')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get all shop items across all sellers' })
  @ApiResponse({
    status: 200,
    description: 'Returns all active shop items from all sellers',
    type: [PrizeConfigurationDto],
  })
  async getAllShopItems(@Request() req: RequestMaybeUser) {
    return this.prizeService.getAllShopItems(req.user?.id);
  }

  /**
   * Public direct-link endpoint for a single shop item. Powers the
   * `/shop/item/:id` page used by share links and email CTAs (e.g.
   * the auction-won email). Returns the same enriched DTO shape as
   * `shop-items` so the page can render either AuctionCard or PrizeCard
   * with all viewer-relative fields populated.
   */
  @Get('shop-items/:id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get a single shop item by id (public)' })
  @ApiParam({ name: 'id', description: 'Prize item id' })
  @ApiResponse({
    status: 200,
    description: 'Returns the enriched shop item',
    type: PrizeConfigurationDto,
  })
  @ApiResponse({ status: 404, description: 'Shop item not found' })
  async getShopItemById(
    @Param('id') id: string,
    @Request() req: RequestMaybeUser,
  ) {
    return this.prizeService.getShopItemById(id, req.user?.id);
  }

  @Get('shop-items/:id/ebay-market-summary')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get sold-market summary metrics for one shop item' })
  @ApiParam({ name: 'id', description: 'Prize item id' })
  @ApiResponse({
    status: 200,
    description: 'Returns latest-10 average, windows, and percent difference',
    type: EbayMarketSummaryDto,
  })
  async getShopItemEbayMarketSummary(
    @Request() req: RequestMaybeUser,
    @Param('id') id: string,
  ): Promise<EbayMarketSummaryDto> {
    return this.prizeService.getItemEbayMarketSummary(id, req.user?.id);
  }

  @Get('shop-items/:id/ebay-market-history')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get sold-market history rows for one shop item' })
  @ApiParam({ name: 'id', description: 'Prize item id' })
  @ApiResponse({
    status: 200,
    description: 'Returns sold listings history and summary metrics',
    type: EbayMarketHistoryDto,
  })
  async getShopItemEbayMarketHistory(
    @Request() req: RequestMaybeUser,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ): Promise<EbayMarketHistoryDto> {
    const parsedLimit = Number(limit);
    return this.prizeService.getItemEbayMarketHistory(
      id,
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      req.user?.id,
    );
  }

  @Post('ebay-sold-listings/:listingId/report')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report a sold listing as inaccurate' })
  @ApiParam({ name: 'listingId', description: 'Sold listing ID' })
  @ApiResponse({ status: 201, description: 'Sold listing flagged for moderation' })
  async reportEbaySoldListing(
    @Request() req: RequestWithUser,
    @Param('listingId') listingId: string,
    @Body() dto: ReportEbaySoldListingDto,
  ): Promise<{ success: true; listingId: string }> {
    return this.prizeService.reportEbaySoldListing(listingId, req.user.id, dto);
  }

  @Get('shops')
  @ApiOperation({ summary: 'Get seller shops with active inventory' })
  @ApiResponse({ status: 200, description: 'Returns seller shops' })
  async getSellerShops(@Query('limit') limit?: string) {
    return this.prizeService.getSellerShops(
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  // ---------------------------------------------------------------------------
  // Engagement: views + watchlist
  // ---------------------------------------------------------------------------

  /**
   * Public: record a batch of item card views. Logged-in users are tracked
   * by user id; anonymous users by the `x-anon-id` header (the client
   * generates and persists a uuid for this in localStorage). Dedupes per
   * (item, viewer, day) so calling this on every render is safe.
   */
  @Post('views')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record item-card views (batched)' })
  @ApiResponse({ status: 204, description: 'Views accepted' })
  async trackViews(
    @Request() req: RequestMaybeUser,
    @Body() body: { itemIds?: string[] },
  ): Promise<void> {
    const itemIds = Array.isArray(body?.itemIds) ? body.itemIds : [];
    const userId = req.user?.id ?? null;
    const anonHeader: unknown = req.headers['x-anon-id'];
    const anonId =
      typeof anonHeader === 'string'
        ? anonHeader.slice(0, 64)
        : Array.isArray(anonHeader)
          ? String(anonHeader[0]).slice(0, 64)
          : null;
    await this.engagementService.trackViews(itemIds, { userId, anonId });
  }

  /**
   * Current user's watchlist (most recent first).
   */
  @Get('watchlist')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the current user's watchlist" })
  getWatchlist(@Request() req: RequestWithUser) {
    return this.prizeService.getUserWatchlist(req.user.id);
  }

  /**
   * Current user's bid history grouped by item, most-recent bid first.
   * Powers the "My Bids" page. Each item includes its full auction
   * summary with `isLeader` and `currentUserProxyMaxUsd` populated for
   * the requesting user.
   */
  @Get('my-bids')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get items the current user has bid on' })
  getMyBids(@Request() req: RequestWithUser) {
    return this.prizeService.getUserBids(req.user.id);
  }

  /**
   * Add an item to the current user's watchlist.
   */
  @Post(':id/watch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Watch an item' })
  @ApiParam({ name: 'id', description: 'Prize item id' })
  async watchItem(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<{ watching: true; watcherCount: number }> {
    return this.engagementService.watchItem(req.user.id, id);
  }

  /**
   * Remove an item from the current user's watchlist.
   */
  @Delete(':id/watch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stop watching an item' })
  @ApiParam({ name: 'id', description: 'Prize item id' })
  async unwatchItem(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<{ watching: false; watcherCount: number }> {
    return this.engagementService.unwatchItem(req.user.id, id);
  }

  @Get('shops/:username/items')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get a seller shop and its active items' })
  @ApiParam({ name: 'username', description: 'Seller username' })
  @ApiResponse({
    status: 200,
    description: 'Returns seller shop details and items',
  })
  @ApiResponse({ status: 404, description: 'Seller shop not found' })
  async getShopItemsByUsername(
    @Param('username') username: string,
    @Request() req: RequestMaybeUser,
  ) {
    const result = await this.prizeService.getPublicShopByUsername(
      username,
      req.user?.id,
    );
    return result;
  }

  @Get('purchases/:username')
  @ApiOperation({ summary: 'Get recent purchases by username (public)' })
  @ApiParam({ name: 'username', description: 'Username to get purchases for' })
  @ApiResponse({
    status: 200,
    description: 'Returns recent purchases for the user',
  })
  async getRecentPurchasesByUsername(
    @Param('username') username: string,
    @Query('limit') limit?: string,
  ) {
    return this.prizeService.getRecentPurchasesByUsername(
      username,
      limit ? parseInt(limit, 10) : 6,
    );
  }
  /**
   * Public endpoint: Get global sales feed (all completed orders)
   */
  @Get('global-sales')
  @ApiOperation({
    summary: 'Get all completed sales across the platform (public)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of completed sales',
  })
  async getGlobalSales(@Query() filterDto: { range?: string; q?: string }) {
    return this.prizeService.getGlobalSales(filterDto);
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

  @Get('my-shop-orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current seller prize orders' })
  @ApiResponse({
    status: 200,
    description: 'Returns user prize orders',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getShopOrders(@Request() req: RequestWithUser) {
    return this.prizeService.getShopOrders(req.user.id);
  }

  /**
   * Public endpoint: Get order success details for purchase confirmation page
   * Allows unauthenticated access since Stripe redirects without JWT token
   */
  @Get('orders/:orderId/success-details')
  @ApiOperation({
    summary: 'Get order details for purchase success page (public)',
  })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({
    status: 200,
    description:
      'Returns order success details including item, price, and seller info',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrderSuccessDetails(@Param('orderId') orderId: string) {
    return this.prizeService.getOrderSuccessDetailsPublic(orderId);
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
   * Admin endpoint: Paginated list of all completed sales transactions.
   * Supports date-range, payment-method (crypto/noncrypto/all) and free-text
   * filters.
   */
  @Get('sales-history')
  @ApiOperation({ summary: 'List all completed sales (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated sales transactions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async getAdminSalesHistory(
    @Request() req: RequestWithUser,
    @Query()
    filterDto: {
      from?: string;
      to?: string;
      paymentMethod?: 'crypto' | 'noncrypto' | 'all';
      range?: string;
      q?: string;
    },
  ) {
    this.ensureAdmin(req.user);
    return this.prizeService.getAdminSalesHistory(filterDto);
  }

  /**
   * Admin endpoint: Monthly aggregate of completed sales with crypto vs
   * non-crypto breakdown. Defaults to the last 12 months.
   */
  @Get('sales-summary')
  @ApiOperation({ summary: 'Monthly sales summary (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Monthly revenue + order counts, plus window totals',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async getAdminSalesSummary(
    @Request() req: RequestWithUser,
    @Query() filterDto: { months?: string },
  ) {
    this.ensureAdmin(req.user);
    const months = filterDto?.months ? parseInt(filterDto.months, 10) : 12;
    return this.prizeService.getAdminSalesSummary({
      months: Number.isFinite(months) ? months : 12,
    });
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
    return this.prizeService.createPrizeTier(
      dto,
      req.user.id,
      dto.createdBy || null,
    );
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
    return this.prizeService.updatePrizeTier(
      id,
      dto,
      req.user.id,
      dto.createdBy,
    );
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
   * Admin endpoint: Bulk update display orders
   */
  @Patch('bulk-display-order')
  @ApiOperation({
    summary: 'Bulk update prize display orders (admin only)',
    description:
      "Update page-specific display orders (shop, redemptions, Nick's Niceties) and featuredDisplayOrder for multiple prizes at once",
  })
  @ApiResponse({
    status: 200,
    description: 'Display orders updated successfully',
    type: [PrizeConfigurationDto],
  })
  @ApiResponse({ status: 400, description: 'Invalid update data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'One or more prizes not found' })
  async bulkUpdateDisplayOrder(
    @Request() req: RequestWithUser,
    @Body() dto: BulkUpdateDisplayOrderDto,
  ): Promise<PrizeConfigurationDto[]> {
    this.ensureAdmin(req.user);
    return this.prizeService.bulkUpdateDisplayOrder(dto.updates, req.user.id);
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

  /**
   * Admin endpoint: Get shop settings for a virtual shop
   */
  @Get('shop-settings/:shopKey')
  @ApiOperation({ summary: 'Get shop settings (admin)' })
  @ApiParam({ name: 'shopKey', description: 'Shop key (e.g., cardcade)' })
  @ApiResponse({ status: 200, description: 'Returns shop settings' })
  async getShopSettings(
    @Request() req: RequestWithUser,
    @Param('shopKey') shopKey: string,
  ) {
    this.ensureAdmin(req.user);
    return this.prizeService.getShopSettings(shopKey);
  }

  /**
   * Admin endpoint: Update shop settings for a virtual shop
   */
  @Patch('shop-settings/:shopKey')
  @ApiOperation({ summary: 'Update shop settings (admin)' })
  @ApiParam({ name: 'shopKey', description: 'Shop key (e.g., cardcade)' })
  @ApiResponse({ status: 200, description: 'Shop settings updated' })
  async updateShopSettings(
    @Request() req: RequestWithUser,
    @Param('shopKey') shopKey: string,
    @Body() dto: UpdateShopSettingsDto,
  ) {
    this.ensureAdmin(req.user);
    return this.prizeService.updateShopSettings(shopKey, dto);
  }

  @Patch('items/:id/ebay-search-query')
  @ApiOperation({ summary: 'Update the eBay search query used for an item (admin)' })
  @ApiParam({ name: 'id', description: 'Prize item ID' })
  @ApiResponse({
    status: 200,
    description: 'eBay search query updated',
    schema: {
      properties: {
        id: { type: 'string' },
        ebaySearchQuery: { type: 'string', nullable: true },
      },
    },
  })
  async updateItemEbaySearchQuery(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateItemEbaySearchQueryDto,
  ): Promise<{ id: string; ebaySearchQuery: string | null }> {
    this.ensureAdmin(req.user);
    return this.prizeService.updateItemEbaySearchQuery(id, dto.ebaySearchQuery);
  }

  @Delete('items/:id/ebay-sold-listings')
  @ApiOperation({ summary: 'Drop all eBay sold listings for one item and reset sync state (admin)' })
  @ApiParam({ name: 'id', description: 'Prize item ID' })
  @ApiResponse({
    status: 200,
    description: 'All sold listings deleted and sync state reset',
    schema: {
      properties: {
        deleted: { type: 'number' },
      },
    },
  })
  async deleteAllItemEbaySoldListings(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<{ deleted: number }> {
    this.ensureAdmin(req.user);
    return this.prizeService.deleteAllItemEbaySoldListings(id);
  }

  @Get('items/:id/ebay-sold-listings')
  @ApiOperation({ summary: 'Get sold listings for one item (admin moderation)' })
  @ApiParam({ name: 'id', description: 'Prize item ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns sold listings including inaccurate flags',
    type: [AdminEbayMarketSoldListingDto],
  })
  async getItemEbaySoldListings(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('includeInaccurate') includeInaccurate?: string,
  ): Promise<AdminEbayMarketSoldListingDto[]> {
    this.ensureAdmin(req.user);
    const parsedLimit = Number(limit);
    const includeInaccurateBool =
      includeInaccurate === undefined
        ? true
        : !['0', 'false', 'no', 'off'].includes(
            includeInaccurate.toLowerCase(),
          );

    return this.prizeService.getItemEbaySoldListingsForAdmin(
      id,
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      includeInaccurateBool,
    );
  }

  @Get('ebay-sold-listings/reported')
  @ApiOperation({ summary: 'Get reported sold listings queue (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Returns reported sold listings across all items',
    type: [AdminReportedEbaySoldListingDto],
  })
  async getReportedEbaySoldListings(
    @Request() req: RequestWithUser,
    @Query('limit') limit?: string,
  ): Promise<AdminReportedEbaySoldListingDto[]> {
    this.ensureAdmin(req.user);
    const parsedLimit = Number(limit);
    return this.prizeService.getReportedEbaySoldListingsForAdmin(
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Patch('ebay-sold-listings/:listingId/moderation')
  @ApiOperation({ summary: 'Mark or clear sold listing inaccurate status (admin)' })
  @ApiParam({ name: 'listingId', description: 'Sold listing ID' })
  @ApiResponse({
    status: 200,
    description: 'Sold listing moderation state updated',
    type: AdminEbayMarketSoldListingDto,
  })
  async moderateEbaySoldListing(
    @Request() req: RequestWithUser,
    @Param('listingId') listingId: string,
    @Body() dto: ModerateEbaySoldListingDto,
  ): Promise<AdminEbayMarketSoldListingDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.moderateEbaySoldListing(listingId, req.user.id, dto);
  }

  @Delete('ebay-sold-listings/bulk')
  @ApiOperation({ summary: 'Bulk hard-delete sold listing rows by ID (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Selected sold listings deleted',
    schema: {
      properties: {
        deleted: { type: 'number' },
      },
    },
  })
  async bulkDeleteEbaySoldListings(
    @Request() req: RequestWithUser,
    @Body() dto: BulkDeleteEbaySoldListingsDto,
  ): Promise<{ deleted: number }> {
    this.ensureAdmin(req.user);
    return this.prizeService.bulkDeleteEbaySoldListings(dto.listingIds);
  }

  @Delete('ebay-sold-listings/:listingId')
  @ApiOperation({ summary: 'Hard delete sold listing row (admin)' })
  @ApiParam({ name: 'listingId', description: 'Sold listing ID' })
  @ApiResponse({
    status: 200,
    description: 'Sold listing deleted',
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        listingId: { type: 'string', example: 'uuid' },
      },
    },
  })
  async deleteEbaySoldListing(
    @Request() req: RequestWithUser,
    @Param('listingId') listingId: string,
  ): Promise<{ success: true; listingId: string }> {
    this.ensureAdmin(req.user);
    return this.prizeService.deleteEbaySoldListingForAdmin(listingId);
  }

  @Post('ebay-sold-listings/:listingId/report/approve')
  @ApiOperation({
    summary:
      'Approve a pending report by removing listing universally from market data (admin)',
  })
  @ApiParam({ name: 'listingId', description: 'Sold listing ID' })
  @ApiResponse({
    status: 200,
    description: 'Report approved and listing removed universally',
    type: AdminEbayMarketSoldListingDto,
  })
  async approveEbaySoldListingReport(
    @Request() req: RequestWithUser,
    @Param('listingId') listingId: string,
    @Body() dto?: { reason?: string },
  ): Promise<AdminEbayMarketSoldListingDto> {
    this.ensureAdmin(req.user);
    return this.prizeService.approveEbaySoldListingReport(
      listingId,
      req.user.id,
      dto?.reason,
    );
  }

  @Post('ebay-sold-listings/:listingId/report/reject')
  @ApiOperation({
    summary:
      'Reject pending reports for a listing, restoring it to market visibility (admin)',
  })
  @ApiParam({ name: 'listingId', description: 'Sold listing ID' })
  @ApiResponse({
    status: 200,
    description: 'Reports rejected and listing remains visible',
  })
  async rejectEbaySoldListingReports(
    @Request() req: RequestWithUser,
    @Param('listingId') listingId: string,
    @Body() dto?: { reason?: string },
  ): Promise<{ success: true; rejectedCount: number }> {
    this.ensureAdmin(req.user);
    return this.prizeService.rejectEbaySoldListingReports(
      listingId,
      req.user.id,
      dto?.reason,
    );
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

  private ensureSellerVerified(user: User): void {
    this.ensureSeller(user);
    if (!user.sellerOnboardingCompleted) {
      throw new ForbiddenException(
        'Please complete Stripe onboarding before managing shop items',
      );
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
    this.ensureSellerVerified(req.user);
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
    this.ensureSellerVerified(req.user);
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
    this.ensureSellerVerified(req.user);
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
    this.ensureSellerVerified(req.user);
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
    this.ensureSellerVerified(req.user);
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
    this.ensureSellerVerified(req.user);
    return this.prizeService.sellerRejectOffer(req.user.id, orderId);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Get my shop orders' })
  @ApiResponse({ status: 200, description: 'Returns seller shop orders' })
  async getMyOrders(
    @Request() req: RequestWithUser,
    @Query() filterDto: { status?: string; range?: string },
  ) {
    this.ensureSeller(req.user);
    return this.prizeService.getSellerOrders(req.user.id, filterDto);
  }

  @Patch('orders/:orderId/mark-shipped')
  @ApiOperation({ summary: 'Mark a shop order as shipped' })
  @ApiParam({ name: 'orderId', description: 'Prize order ID' })
  @ApiResponse({ status: 200, type: PrizeOrderResponseDto })
  async markOrderAsShipped(
    @Request() req: RequestWithUser,
    @Param('orderId') orderId: string,
    @Body() dto: MarkAsShippedDto,
  ): Promise<PrizeOrderResponseDto> {
    this.ensureSellerVerified(req.user);
    return this.prizeService.sellerMarkAsShipped(req.user.id, orderId, dto);
  }

  @Patch('profile-featured')
  @ApiOperation({
    summary: 'Update which items are featured on profile (max 10, PRO only)',
  })
  @ApiResponse({ status: 200, description: 'Featured items updated' })
  async updateProfileFeatured(
    @Request() req: RequestWithUser,
    @Body() body: { featuredItemIds: string[] },
  ) {
    this.ensureSellerVerified(req.user);
    return this.prizeService.updateProfileFeaturedItems(
      req.user.id,
      body.featuredItemIds || [],
    );
  }
}
