import { Controller, Get, HttpStatus } from '@nestjs/common';
import { CoinPackageService } from './coin-package.service';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CoinPackageListResponseDto } from './dto/coin-package.dto';

@ApiTags('coin-package')
@Controller('coin-package')
export class CoinPackageController {
  constructor(private readonly coinPackageService: CoinPackageService) {}

  /**
   * Lists all active coin packages.
   */
  @ApiOperation({ summary: 'List active coin packages' })
  @ApiOkResponse({ description: 'Coin packages retrieved successfully', type: CoinPackageListResponseDto })
  @Get()
  async findAll() {
    const coinPackages = await this.coinPackageService.findAll();
    return {
      statusCode: HttpStatus.OK,
      message: 'Coin packages retrieved successfully',
      data: coinPackages,
    };
  }
}
