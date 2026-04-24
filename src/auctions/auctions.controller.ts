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
import {
  CreateSetupIntentResponseDto,
} from './dto/setup-intent.dto';
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
  async create(
    @Body() dto: CreateAuctionDto,
    @Request() req: RequestWithUser,
  ) {
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
}
