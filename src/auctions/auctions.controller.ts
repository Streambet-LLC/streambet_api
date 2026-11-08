import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { AuctionsService } from './auctions.service';
import { AuctionsPaymentsService } from './auctions-payments.service';
import { AuctionsCryptoService } from './auctions-crypto.service';
import {
  CryptoDepositConfirmDto,
  CryptoDepositQuoteDto,
  PaymentSetupDto,
  PlaceBidDto,
  RetryCheckoutDto,
} from './dto/place-bid.dto';
import { ListAuctionsQueryDto } from './dto/list-auctions.dto';
import {
  BUYER_PREMIUM_PERCENT,
  CARD_PROCESSING_FIXED_USD,
  CARD_PROCESSING_PERCENT,
} from './hermes.pricing';
import { isClientOrigin } from '../common/utils/client-origins';

interface RequestWithUser extends Request {
  user: User;
}
interface RequestWithOptionalUser extends Request {
  user?: User;
}

class ConfirmSessionDto {
  @IsString()
  @Matches(/^cs_[A-Za-z0-9_]+$/)
  sessionId: string;
}

/** Public + bidder routes for Hermes Auctions. */
@ApiTags('hermes-auctions')
@Controller('auctions')
export class AuctionsController {
  constructor(
    private readonly auctions: AuctionsService,
    private readonly payments: AuctionsPaymentsService,
    private readonly crypto: AuctionsCryptoService,
    private readonly config: ConfigService,
  ) {}

  /** Stripe may only send bidders back to our own sites (main or Hermes). */
  private assertReturnUrl(url: string): void {
    if (!isClientOrigin(this.config, url, { allowAnyLocalhost: true })) {
      throw new BadRequestException('Invalid return URL.');
    }
  }

  /** Browse / search. `total` counts every match, for "load more". */
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  async list(
    @Request() req: RequestWithOptionalUser,
    @Query() query: ListAuctionsQueryDto,
  ) {
    if (
      query.minPrice != null &&
      query.maxPrice != null &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException('minPrice must be at most maxPrice.');
    }
    const { rows, total } = await this.auctions.listPublic({
      ...query,
      bucket: query.bucket ?? 'live',
      viewerId: req.user?.id,
    });
    return { data: rows, total };
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('featured')
  async featured(
    @Request() req: RequestWithOptionalUser,
    @Query('limit') limit?: string,
  ) {
    return {
      data: await this.auctions.listFeatured(Number(limit) || 6, req.user?.id),
    };
  }

  @Get('config')
  config_() {
    return {
      data: {
        crypto: this.crypto.publicConfig(),
        fees: {
          // Rate for new auctions; each auction's own rate is in its `fees`.
          buyerPremiumPercent: BUYER_PREMIUM_PERCENT,
          cardProcessingPercent: CARD_PROCESSING_PERCENT,
          cardProcessingFixedUsd: CARD_PROCESSING_FIXED_USD,
        },
      },
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async mine(@Request() req: RequestWithUser) {
    return { data: await this.auctions.listMine(req.user.id) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me/payment-methods')
  async methods(@Request() req: RequestWithUser) {
    return { data: await this.payments.listSavedMethods(req.user.id) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('payment-setup')
  async paymentSetup(
    @Request() req: RequestWithUser,
    @Body() dto: PaymentSetupDto,
  ) {
    this.assertReturnUrl(dto.returnUrl);
    return {
      data: await this.payments.createSetupCheckoutSession(
        req.user.id,
        dto.method,
        dto.returnUrl,
      ),
    };
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async get(
    @Request() req: RequestWithOptionalUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.auctions.getPublic(id, req.user?.id) };
  }

  @Get(':id/bids')
  async bids(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.auctions.getPublicBids(id) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/bids')
  async bid(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlaceBidDto,
  ) {
    return { data: await this.auctions.placeBid(req.user.id, id, dto) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/crypto/quote')
  async cryptoQuote(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CryptoDepositQuoteDto,
  ) {
    return { data: await this.auctions.quoteDeposit(req.user.id, id, dto) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/crypto/confirm')
  async cryptoConfirm(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CryptoDepositConfirmDto,
  ) {
    return { data: await this.auctions.confirmDeposit(req.user.id, id, dto) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/payment')
  async payment(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.auctions.getPaymentInfo(req.user.id, id) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/payment/checkout')
  async paymentCheckout(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetryCheckoutDto,
  ) {
    this.assertReturnUrl(dto.returnUrl);
    return {
      data: await this.auctions.createRetryCheckout({
        userId: req.user.id,
        auctionId: id,
        method: dto.method,
        returnUrl: dto.returnUrl,
      }),
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post(':id/payment/confirm')
  async paymentConfirm(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmSessionDto,
  ) {
    await this.auctions.confirmCheckoutSession(dto.sessionId, req.user.id);
    return { data: await this.auctions.getPaymentInfo(req.user.id, id) };
  }
}
