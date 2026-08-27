import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
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
import { MarketTaxonomyService } from './market-taxonomy.service';
import { MarketTaxonomyNode, TaxonomyKind } from './entities/market-taxonomy.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

/**
 * The market-taxonomy backbone — the hierarchy (market → sub-category → set →
 * card + cross-cutting player/character nodes) that every heat and engagement
 * metric slices by. Auto-seeded, then curated here.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/analytics/market/taxonomy')
@UseGuards(JwtAuthGuard)
export class MarketTaxonomyController {
  constructor(private readonly taxonomy: MarketTaxonomyService) {}

  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  @ApiOperation({ summary: 'Flat node list (optional rootMarket / kind filter)' })
  @Get('list')
  async list(
    @Request() req: RequestWithUser,
    @Query('rootMarket') rootMarket?: string,
    @Query('kind') kind?: TaxonomyKind,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.taxonomy.list({ rootMarket, kind });
    return { status: HttpStatus.OK, message: 'Taxonomy nodes fetched', data };
  }

  @ApiOperation({ summary: 'Node counts by kind' })
  @Get('stats')
  async stats(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.taxonomy.stats();
    return { status: HttpStatus.OK, message: 'Taxonomy stats fetched', data };
  }

  @ApiOperation({ summary: 'Classify one card name (+ optional brand) against the tree' })
  @Get('classify')
  async classify(
    @Request() req: RequestWithUser,
    @Query('name') name: string,
    @Query('brand') brand?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.taxonomy.classify(name || '', brand);
    return { status: HttpStatus.OK, message: 'Classified', data };
  }

  @ApiOperation({ summary: 'Auto-tag coverage preview over an existing card table' })
  @Get('distribution')
  async distribution(
    @Request() req: RequestWithUser,
    @Query('source') source?: 'tracked_cards' | 'sold_cards',
    @Query('limit') limit?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const lim = Number.parseInt(limit ?? '', 10);
    const data = await this.taxonomy.distribution(
      source === 'sold_cards' ? 'sold_cards' : 'tracked_cards',
      Number.isFinite(lim) ? lim : 5000,
    );
    return { status: HttpStatus.OK, message: 'Distribution computed', data };
  }

  @ApiOperation({ summary: 'Full taxonomy tree (optional ?rootMarket)' })
  @Get()
  async tree(
    @Request() req: RequestWithUser,
    @Query('rootMarket') rootMarket?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.taxonomy.tree(rootMarket);
    return { status: HttpStatus.OK, message: 'Taxonomy tree fetched', data };
  }

  @ApiOperation({ summary: 'Seed / re-seed the default tree (curated nodes preserved)' })
  @Post('seed')
  async seed(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.taxonomy.seedDefaults();
    return { status: HttpStatus.OK, message: 'Default taxonomy seeded', data };
  }

  @ApiOperation({ summary: 'Create a taxonomy node (curated)' })
  @Post('node')
  async create(
    @Request() req: RequestWithUser,
    @Body() body: Partial<MarketTaxonomyNode> & { key: string; kind: TaxonomyKind; rootMarket: string; label: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.taxonomy.createNode(body);
    return { status: HttpStatus.CREATED, message: 'Node created', data };
  }

  @ApiOperation({ summary: 'Update a taxonomy node (pins it against re-seed)' })
  @Patch('node/:key')
  async update(
    @Request() req: RequestWithUser,
    @Param('key') key: string,
    @Body() body: Partial<MarketTaxonomyNode>,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.taxonomy.updateNode(key, body);
    return { status: HttpStatus.OK, message: 'Node updated', data };
  }

  @ApiOperation({ summary: 'Delete a taxonomy node (must have no children)' })
  @Delete('node/:key')
  async remove(
    @Request() req: RequestWithUser,
    @Param('key') key: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.taxonomy.deleteNode(key);
    return { status: HttpStatus.OK, message: 'Node deleted', data };
  }
}
