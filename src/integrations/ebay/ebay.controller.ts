import {
  Body,
  Controller,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from 'src/enums/user-role.enum';
import { User } from '../../users/entities/user.entity';
import {
  EbayImageSearchRequestDto,
  EbaySearchRequestDto,
  EbaySearchResponseDto,
} from './dto/ebay-search.dto';
import { EbayService } from './ebay.service';
import { EbayRateLimitService } from './ebay-rate-limit.service';

interface RequestWithUser {
  user: User;
}

@ApiTags('ebay')
@ApiBearerAuth()
@Controller('seller/prizes/ebay')
@UseGuards(JwtAuthGuard)
export class EbayController {
  constructor(
    private readonly ebayService: EbayService,
    private readonly ebayRateLimitService: EbayRateLimitService,
    private readonly configService: ConfigService,
  ) {}

  private ensureEbayAccess(user: User): void {
    const enabled = this.configService.get<boolean>('ebay.enabled') ?? false;
    const accessMode =
      this.configService.get<'admin-only' | 'everyone'>('ebay.accessMode') ?? 'admin-only';

    if (!enabled) {
      throw new NotFoundException('eBay search feature is disabled');
    }

    if (accessMode === 'admin-only' && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  @Post('search')
  @ApiOperation({ summary: 'Search eBay active listings by title' })
  @ApiResponse({ status: 200, type: EbaySearchResponseDto })
  async searchListings(
    @Body() body: EbaySearchRequestDto,
    @Request() req: RequestWithUser,
  ): Promise<EbaySearchResponseDto> {
    this.ensureEbayAccess(req.user);

    const rateLimitResult = await this.ebayRateLimitService.checkAndConsume(String(req.user.id));
    if (!rateLimitResult.allowed) {
      throw new HttpException({
        message: 'Too many eBay lookups. Please retry after the cooldown window.',
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const limit = body.limit && body.limit > 0 && body.limit <= 50 ? body.limit : 5;
    return this.ebayService.searchListings(body.title, limit);
  }

  @Post('search-by-image')
  @ApiOperation({ summary: 'Search eBay active listings by image' })
  @ApiResponse({ status: 200, type: EbaySearchResponseDto })
  async searchListingsByImage(
    @Body() body: EbayImageSearchRequestDto,
    @Request() req: RequestWithUser,
  ): Promise<EbaySearchResponseDto> {
    this.ensureEbayAccess(req.user);

    const rateLimitResult = await this.ebayRateLimitService.checkAndConsume(String(req.user.id));
    if (!rateLimitResult.allowed) {
      throw new HttpException({
        message: 'Too many eBay lookups. Please retry after the cooldown window.',
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const limit = body.limit && body.limit > 0 && body.limit <= 50 ? body.limit : 5;
    return this.ebayService.searchListingsByImage(body.imageBase64, limit);
  }
}
