import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Request,
  UseGuards,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../enums/user-role.enum';
import { ApiResponse } from '../common/types/api-response.interface';
import { MarketEngagementService } from './market-engagement.service';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

/**
 * First-party engagement — our platform's views + saves rolled up to taxonomy
 * nodes and charted over time. The reliable signal we own, alongside eBay heat.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/analytics/market/engagement')
@UseGuards(JwtAuthGuard)
export class MarketEngagementController {
  constructor(private readonly engagement: MarketEngagementService) {}

  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  @ApiOperation({ summary: 'Latest engagement per node (scope + optional market drill-down)' })
  @Get()
  async latest(
    @Request() req: RequestWithUser,
    @Query('scope') scope?: string,
    @Query('market') market?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.engagement.latest(scope, market);
    return { status: HttpStatus.OK, message: 'Market engagement fetched', data };
  }

  @ApiOperation({ summary: 'Manually run an engagement snapshot now' })
  @Post('collect')
  async collect(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.engagement.collectAll();
    return { status: HttpStatus.OK, message: 'Market engagement collected', data };
  }

  @ApiOperation({ summary: 'Engagement time series for one node' })
  @Get(':segment')
  async series(
    @Request() req: RequestWithUser,
    @Param('segment') segment: string,
    @Query('days') days?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const n = Number.parseInt(days ?? '', 10);
    const data = await this.engagement.series(segment, Number.isFinite(n) ? n : 60);
    return { status: HttpStatus.OK, message: 'Engagement series fetched', data };
  }
}
