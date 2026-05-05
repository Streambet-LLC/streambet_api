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
  constructor(private readonly syncService: EbaySoldMarketSyncService) {}

  private ensureAdmin(user: User): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
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
    query: string;
    calculatedAt: Date;
  }> {
    this.ensureAdmin(req.user);
    return this.syncService.runManualSyncForItem(itemId);
  }
}
