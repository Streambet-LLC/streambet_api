import { Controller, Get, HttpStatus, UseGuards, BadRequestException, Request } from '@nestjs/common';
import { CoinPackageService } from './coin-package.service';
import { ApiOkResponse, ApiOperation, ApiTags, ApiBearerAuth, ApiBadRequestResponse } from '@nestjs/swagger';
import { CoinPackageListResponseDto } from './dto/coin-package.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletsService } from '../wallets/wallets.service';
import { LIFETIME_PURCHASE_CAP_USD } from '../common/constants/purchase.constants';
import { User } from '../users/entities/user.entity';
import { Request as ExpressRequest } from 'express';
import { plainToInstance } from 'class-transformer';
import { CoinPackageDto } from './dto/coin-package.dto';

// Define request with user
interface RequestWithUser extends ExpressRequest {
  user: User;
}

@ApiTags('coin-package')
@Controller('coin-package')
export class CoinPackageController {
  constructor(
    private readonly coinPackageService: CoinPackageService,
    private readonly walletsService: WalletsService,
  ) {}

  /**
   * GET /coin-package
   *
   * Purpose:
   *   - Returns **all** active coin packages, each with a `canPurchase` flag
   *     indicating whether the user can afford it within their current
   *     remaining lifetime limit.
   *   - Throws 400 when `remainingUSD` is **less than the price of the cheapest
   *     active package**; at that point the user cannot purchase anything even
   *     though the numeric limit may not be strictly zero.
   *
   * @param req - Express request augmented by `JwtAuthGuard` to contain `user.id`.
   * @returns CoinPackageListResponseDto
   */
  @ApiOperation({ summary: 'List active coin packages with canPurchase flag by remaining lifetime limit' })
  @ApiOkResponse({ description: 'Coin packages retrieved successfully', type: CoinPackageListResponseDto })
  @ApiBadRequestResponse({ description: 'No coin package can be purchased within your remaining lifetime limit.' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@Request() req: RequestWithUser) {
    const userId = req.user.id;

    const capUSD = LIFETIME_PURCHASE_CAP_USD;
    const { spentUSD, remainingUSD } = await this.walletsService.getLifetimeRemainingUSDFromCap(
      userId,
      capUSD,
    );

    // Convert raw entities to DTO instances to ensure only whitelisted fields are exposed
    const dtoPackages = plainToInstance(CoinPackageDto, await this.coinPackageService.findAll(), {
      excludeExtraneousValues: true,
    });

    const enriched = dtoPackages.map((pkg) => {
      const price = Number((pkg as any).totalAmount);
      const safePrice = Number.isFinite(price) ? price : Infinity;
      return { ...pkg, canPurchase: safePrice <= remainingUSD };
    });

    // Check if the user can purchase at least one package; if not, throw 400
    const hasPurchasable = enriched.some((p: any) => p.canPurchase);
    if (!hasPurchasable) {
      throw new BadRequestException('Lifetime purchase limit reached. No coin packages available within your remaining limit.');
    }

    return {
      statusCode: HttpStatus.OK,
      message: 'Coin packages retrieved successfully',
      data: enriched,
      spentUSD,
      remainingUSD,
      capUSD,
    } as CoinPackageListResponseDto;
  }
}
