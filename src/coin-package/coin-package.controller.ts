import { Controller, Get, HttpStatus, UseGuards, BadRequestException, Request } from '@nestjs/common';
import { CoinPackageService } from './coin-package.service';
import { ApiOkResponse, ApiOperation, ApiTags, ApiBearerAuth, ApiBadRequestResponse } from '@nestjs/swagger';
import { CoinPackageListResponseDto } from './dto/coin-package.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletsService } from '../wallets/wallets.service';
import { LIFETIME_PURCHASE_CAP_USD } from '../common/constants/purchase.constants';
import { User } from '../users/entities/user.entity';
import { Request as ExpressRequest } from 'express';

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
   *   - Returns **all** active coin packages but adds a boolean `canPurchase`
   *     flag to each indicating whether the user can afford it within their
   *     remaining lifetime limit.
   *   - Includes aggregate limit information (`spentUSD`, `remainingUSD`, `capUSD`)
   *     in the response for UI display.
   *   - Throws 400 (`Lifetime purchase limit reached`) if the user has exhausted
   *     their lifetime limit and therefore cannot purchase any package.
   *
   * @param req - Express request augmented by `JwtAuthGuard` to contain `user.id`.
   * @returns CoinPackageListResponseDto
   */
  @ApiOperation({ summary: 'List active coin packages with canPurchase flag by remaining lifetime limit' })
  @ApiOkResponse({ description: 'Coin packages retrieved successfully', type: CoinPackageListResponseDto })
  @ApiBadRequestResponse({ description: 'Lifetime purchase limit reached. No coin packages available within your remaining limit.' })
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

    const coinPackages = await this.coinPackageService.findAll();

    const enriched = coinPackages.map((pkg: any) => ({
      ...pkg,
      canPurchase: Number(pkg.totalAmount) <= remainingUSD,
    }));

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
