import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Request,
  UseGuards,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../enums/user-role.enum';
import { AuctionsService } from './auctions.service';
import { AuctionsPaymentsService } from './auctions-payments.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';
import { CreateSetupIntentResponseDto } from './dto/setup-intent.dto';
import { AuctionSummaryDto } from '../prize/dto/prize-config.dto';

interface RequestWithUser extends Request {
  user: User;
}

interface RequestMaybeUser extends Request {
  user?: User;
}

/**
 * Public auctions API.
 *  - GET /auctions               → list active auctions (for top bar / shop)
 *  - GET /auctions/:id           → per-user detail with isLeader/isBidder
 *  - POST /auctions/:id/bid      → place a bid (auth required, saved card required)
 *  - POST /auctions/setup-intent → create a SetupIntent so the bidder can save a card
 *  - GET /auctions/me/cards      → list the bidder's saved cards
 */
@ApiTags('auctions')
@Controller('auctions')
export class AuctionsController {
  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly paymentsService: AuctionsPaymentsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List currently active auctions' })
  @UseGuards(OptionalJwtAuthGuard)
  async listActive(
    @Request() req: RequestMaybeUser,
  ): Promise<AuctionSummaryDto[]> {
    const auctions = await this.auctionsService.listActive();
    const userId = req.user?.id;
    const bidderSet = userId
      ? await this.auctionsService.getBidderAuctionIds(
          userId,
          auctions.map((a) => a.id),
        )
      : new Set<string>();
    return auctions.map((a) =>
      this.auctionsService.buildSummary(a, {
        userId,
        isBidder: bidderSet.has(a.id),
      }),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an auction by id (per-user view)' })
  @UseGuards(OptionalJwtAuthGuard)
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: RequestMaybeUser,
  ): Promise<AuctionSummaryDto> {
    const auction = await this.auctionsService.getById(id);
    const userId = req.user?.id;
    const bidderSet = userId
      ? await this.auctionsService.getBidderAuctionIds(userId, [auction.id])
      : new Set<string>();
    return this.auctionsService.buildSummary(auction, {
      userId,
      isBidder: bidderSet.has(auction.id),
    });
  }

  @Post(':id/bid')
  @ApiOperation({ summary: 'Place a bid on an auction' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async placeBid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlaceBidDto,
    @Request() req: RequestWithUser,
  ): Promise<AuctionSummaryDto> {
    const { auction } = await this.auctionsService.placeBid(
      req.user.id,
      id,
      dto,
    );
    return this.auctionsService.buildSummary(auction, {
      userId: req.user.id,
      isBidder: true,
    });
  }

  @Post('setup-intent')
  @ApiOperation({
    summary:
      'Create a Stripe SetupIntent so the bidder can save a card off-session.',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 201, type: CreateSetupIntentResponseDto })
  async createSetupIntent(
    @Request() req: RequestWithUser,
  ): Promise<CreateSetupIntentResponseDto> {
    return this.paymentsService.createSetupIntent(req.user.id);
  }

  @Post('setup-checkout')
  @ApiOperation({
    summary:
      'Create a hosted Stripe Checkout (mode=setup) so the bidder can save a card via redirect. Avoids shipping Stripe Elements client-side.',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async createSetupCheckout(
    @Body() body: { returnUrl: string },
    @Request() req: RequestWithUser,
  ): Promise<{ url: string }> {
    return this.paymentsService.createSetupCheckoutSession(
      req.user.id,
      body.returnUrl,
    );
  }

  @Get('me/cards')
  @ApiOperation({ summary: "List the current user's saved auction cards" })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async listCards(@Request() req: RequestWithUser) {
    return this.paymentsService.listSavedCards(req.user.id);
  }
}

/**
 * Admin auctions API.
 *  - POST /admin/auctions             → create
 *  - POST /admin/auctions/:id/cancel  → cancel
 */
@ApiTags('admin-auctions')
@ApiBearerAuth()
@Controller('admin/auctions')
@UseGuards(JwtAuthGuard)
export class AdminAuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  private ensureAdmin(user: User): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new auction (admin only)' })
  async create(@Body() dto: CreateAuctionDto, @Request() req: RequestWithUser) {
    this.ensureAdmin(req.user);
    const auction = await this.auctionsService.createAuction(req.user.id, dto);
    return auction;
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an auction (admin only)' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: RequestWithUser,
  ) {
    this.ensureAdmin(req.user);
    return this.auctionsService.cancelAuction(req.user.id, id);
  }

  /**
   * Manually trigger the close flow for an auction. Useful when the
   * BullMQ close job got out of sync with the DB (e.g. an admin
   * adjusted endsAt directly in Postgres) so the auction is sitting
   * `active` past its end time. Idempotent — runCloseJob short-circuits
   * if the auction is already in a terminal state.
   */
  @Post(':id/force-close')
  @ApiOperation({
    summary:
      'Force-close an auction now (admin only). Charges the winner and creates the order if applicable.',
  })
  async forceClose(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: RequestWithUser,
  ) {
    this.ensureAdmin(req.user);
    await this.auctionsService.runCloseJob(id);
    const auction = await this.auctionsService.getById(id);
    return this.auctionsService.buildSummary(auction, {
      userId: req.user.id,
    });
  }

  /**
   * Admin listing of every auction with its current state. Powers the
   * Admin → Auctions tab so ops can see every auction across all
   * statuses and act on stuck ones.
   */
  @Get()
  @ApiOperation({ summary: 'List all auctions with admin metadata' })
  async listAll(@Request() req: RequestWithUser) {
    this.ensureAdmin(req.user);
    return this.auctionsService.listAllForAdmin();
  }

  /**
   * Per-auction admin detail: winner identity + shipping address from
   * the linked PrizeOrder. Used by the Edit Item dialog so ops can ship
   * without leaving the screen.
   */
  @Get(':id/details')
  @ApiOperation({ summary: 'Get admin auction details (winner + shipping)' })
  async getDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: RequestWithUser,
  ) {
    this.ensureAdmin(req.user);
    return this.auctionsService.getAdminDetails(id);
  }

  /**
   * Full bid history for the auction, newest first. Used by the admin
   * detail dialog so ops can see exactly who bid what.
   */
  @Get(':id/bids')
  @ApiOperation({ summary: 'Get full bid history for an auction (admin only)' })
  async getBids(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: RequestWithUser,
  ) {
    this.ensureAdmin(req.user);
    return this.auctionsService.getAdminBidHistory(id);
  }
}

/**
 * Seller-facing auction creation. Gated by:
 *   - JWT auth (must be signed in)
 *   - `auctionsEnabled` flag on the user (enforced inside
 *     `auctionsService.createAuction`)
 *   - The prize being auctioned must have been created by the seller.
 *
 * Admins should use `/admin/auctions` (no ownership check).
 */
@ApiTags('seller-auctions')
@ApiBearerAuth()
@Controller('seller/auctions')
@UseGuards(JwtAuthGuard)
export class SellerAuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new auction for one of your shop items' })
  async create(@Body() dto: CreateAuctionDto, @Request() req: RequestWithUser) {
    // Verify the prize belongs to this seller before we hand it off
    // to the service. The service will additionally enforce the
    // auctionsEnabled flag, so admins without the flag are blocked
    // even if they hit this route.
    await this.auctionsService.assertPrizeOwnedBy(
      dto.prizeConfigurationId,
      req.user.id,
    );
    const auction = await this.auctionsService.createAuction(req.user.id, dto);
    return auction;
  }
}
