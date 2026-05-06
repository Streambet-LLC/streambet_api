import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { UserRole } from 'src/enums/user-role.enum';
import { PrizeService } from 'src/prize/prize.service';
import { User } from 'src/users/entities/user.entity';
import { EbaySoldMarketSyncService } from './ebay-sold-market-sync.service';

interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('admin-ebay-market')
@ApiBearerAuth()
@Controller('admin/ebay-market')
@UseGuards(JwtAuthGuard)
export class EbaySoldMarketAdminController {
  constructor(
    private readonly syncService: EbaySoldMarketSyncService,
    private readonly prizeService: PrizeService,
  ) {}

  private ensureAdmin(user: User): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  private async ensureManualSyncEnabled(): Promise<void> {
    const flags = await this.prizeService.getEbayFeatureFlags();
    if (!flags.ebayManualSyncEnabled) {
      throw new ForbiddenException(
        'Manual eBay sold sync is disabled by admin feature controls',
      );
    }
  }

  @Post('sync-all')
  @ApiOperation({ summary: 'Start incremental sync for all active items (admin). Returns immediately; sync runs in background.' })
  @ApiResponse({
    status: 201,
    description: 'Sync-all queued or already running',
    schema: {
      properties: {
        alreadyRunning: { type: 'boolean' },
        queued: { type: 'number' },
        itemIds: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  async syncAll(
    @Request() req: RequestWithUser,
  ): Promise<{ alreadyRunning: boolean; queued: number; itemIds: string[] }> {
    this.ensureAdmin(req.user);
    await this.ensureManualSyncEnabled();
    return this.syncService.startSyncAll();
  }

  @Patch('items/:itemId/sync-now')
  @ApiOperation({ summary: 'Manually sync eBay sold listings for a specific item' })
  @ApiParam({ name: 'itemId', description: 'Prize item id' })
  @ApiResponse({
    status: 200,
    description: 'Manual sync completed',
  })
  async syncItemNow(
    @Request() req: RequestWithUser,
    @Param('itemId') itemId: string,
    @Body() _body?: Record<string, never>,
  ): Promise<{
    itemId: string;
    fetched: number;
    inserted: number;
    deduped: number;
    autoFlagged: number;
    query: string;
    calculatedAt: Date;
  }> {
    this.ensureAdmin(req.user);
    await this.ensureManualSyncEnabled();
    return this.syncService.runManualSyncForItem(itemId);
  }

  @Post('migrate-psa-grade-flags')
  @ApiOperation({ 
    summary: 'One-time migration: Retroactively apply PSA grade, card number, and year filtering to all existing sold listings (admin)' 
  })
  @ApiResponse({
    status: 201,
    description: 'Migration completed',
    schema: {
      properties: {
        totalListings: { type: 'number' },
        flaggedCount: { type: 'number' },
        unflaggedCount: { type: 'number' },
        unchangedCount: { type: 'number' },
      },
    },
  })
  async migratePsaGradeFlags(
    @Request() req: RequestWithUser,
  ): Promise<{
    totalListings: number;
    flaggedCount: number;
    unflaggedCount: number;
    unchangedCount: number;
  }> {
    this.ensureAdmin(req.user);
    return this.syncService.migratePsaGradeFlags();
  }
}
