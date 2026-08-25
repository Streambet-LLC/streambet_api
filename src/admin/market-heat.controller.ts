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
import { MarketHeatService } from './market-heat.service';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

/**
 * Real-time market-heat indicators, derived from daily active-listing
 * snapshots (leading, not the lagging sold comps).
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/analytics/market/heat')
@UseGuards(JwtAuthGuard)
export class MarketHeatController {
  constructor(private readonly heat: MarketHeatService) {}

  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  /** Parse a query-string int, falling back to `def` for missing/non-numeric. */
  private int(raw: string | undefined, def: number): number {
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) ? n : def;
  }

  @ApiOperation({ summary: 'Latest heat point per market (scope: segment|set|card|all)' })
  @Get()
  async latest(
    @Request() req: RequestWithUser,
    @Query('scope') scope?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.heat.latest(scope);
    return { status: HttpStatus.OK, message: 'Market heat fetched successfully', data };
  }

  @ApiOperation({ summary: 'Biggest heat movers (gainers/losers) vs. prior snapshot' })
  @Get('movers')
  async movers(
    @Request() req: RequestWithUser,
    @Query('scope') scope?: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.heat.movers(scope, this.int(limit, 12));
    return { status: HttpStatus.OK, message: 'Market movers fetched successfully', data };
  }

  @ApiOperation({ summary: 'Composed market digest + notable moves (alerts)' })
  @Get('digest')
  async digest(
    @Request() req: RequestWithUser,
    @Query('scope') scope?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.heat.digest(scope || 'segment');
    return { status: HttpStatus.OK, message: 'Market digest fetched', data };
  }

  @ApiOperation({ summary: 'Heat time series for one market segment' })
  @Get(':segment')
  async series(
    @Request() req: RequestWithUser,
    @Param('segment') segment: string,
    @Query('days') days?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.heat.series(segment, this.int(days, 60));
    return { status: HttpStatus.OK, message: 'Market heat series fetched', data };
  }

  @ApiOperation({ summary: 'Interested buyers/leads + sellers for a market (heat ↔ CRM)' })
  @Get(':segment/audience')
  async audience(
    @Request() req: RequestWithUser,
    @Param('segment') segment: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.heat.matchAudience(segment, this.int(limit, 20));
    return { status: HttpStatus.OK, message: 'Market audience fetched', data };
  }

  @ApiOperation({ summary: 'Manually run a market-heat snapshot now' })
  @Post('collect')
  async collect(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.heat.collectAll();
    return { status: HttpStatus.OK, message: 'Market heat collected', data };
  }
}
