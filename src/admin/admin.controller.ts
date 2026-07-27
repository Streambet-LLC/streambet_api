import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Patch,
  Put,
  ForbiddenException,
  HttpStatus,
  Query,
  Delete,
  HttpCode,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { ApiResponse } from '../common/types/api-response.interface';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { SellerInventoryService } from './seller-inventory.service';
import { GoogleSheetsService } from './google-sheets.service';
import { AcquisitionService } from './acquisition/acquisition.service';
import { MarketService } from './market.service';
import { SoldCardsService } from './sold-cards.service';
import { ForecastService } from './forecast.service';
import { InsightsService } from './insights.service';
import { DeepResearchService } from './deep-research.service';
import { ClaudeUsageService } from '../integrations/ai/claude-usage.service';
import { InsightsHistoryService } from './insights-history.service';
import {
  MarketPulseService,
  MARKET_SEGMENTS,
  MARKET_METRICS,
} from './market-pulse.service';
import { DashboardConfigService } from './dashboard-config.service';
import { CardProfileService } from './card-profile.service';
import type { AiChatMessage, AiImage } from '../integrations/ai/ai.service';
import { IngestSellerInventoryDto } from './dto/seller-inventory.dto';
import { UserRole } from 'src/enums/user-role.enum';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private readonly sellerInventoryService: SellerInventoryService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly acquisitionService: AcquisitionService,
    private readonly marketService: MarketService,
    private readonly soldCardsService: SoldCardsService,
    private readonly forecastService: ForecastService,
    private readonly insightsService: InsightsService,
    private readonly deepResearchService: DeepResearchService,
    private readonly insightsHistoryService: InsightsHistoryService,
    private readonly marketPulseService: MarketPulseService,
    private readonly dashboardConfigService: DashboardConfigService,
    private readonly cardProfileService: CardProfileService,
    private readonly claudeUsageService: ClaudeUsageService,
  ) {}

  // Helper method to check if user is admin
  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  // ----------------------------------------------------------------------
  // Seller document ingest — upload inventory (CSV / Excel / Google Sheets)
  // and match products against CardCade buyers.
  // ----------------------------------------------------------------------

  @ApiOperation({ summary: 'Ingest a seller inventory upload and match buyers' })
  @Post('analytics/sellers/inventory')
  async ingestSellerInventory(
    @Request() req: RequestWithUser,
    @Body() dto: IngestSellerInventoryDto,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.sellerInventoryService.ingest(dto, req.user.id);
    return {
      status: HttpStatus.CREATED,
      message: 'Inventory ingested and matched successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'List seller inventory uploads' })
  @Get('analytics/sellers/inventory')
  async listSellerInventory(
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.sellerInventoryService.listUploads();
    return {
      status: HttpStatus.OK,
      message: 'Inventory uploads fetched successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Get a seller inventory upload with matched buyers' })
  @ApiParam({ name: 'id', description: 'Upload ID' })
  @Get('analytics/sellers/inventory/:id')
  async getSellerInventory(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.sellerInventoryService.getUploadDetail(id);
    return {
      status: HttpStatus.OK,
      message: 'Inventory upload fetched successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Delete a seller inventory upload' })
  @ApiParam({ name: 'id', description: 'Upload ID' })
  @Delete('analytics/sellers/inventory/:id')
  async deleteSellerInventory(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    await this.sellerInventoryService.deleteUpload(id);
    return {
      status: HttpStatus.OK,
      message: 'Inventory upload deleted successfully',
      data: { id },
    };
  }

  // ----------------------------------------------------------------------
  // Google Sheets ingest (OAuth). Requires GOOGLE_CLIENT_ID /
  // GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI to be configured.
  // ----------------------------------------------------------------------

  @ApiOperation({ summary: 'Get Google OAuth consent URL for Sheets import' })
  @Get('analytics/sellers/google/auth-url')
  async googleAuthUrl(
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = this.googleSheetsService.getAuthUrl(req.user.id);
    return {
      status: HttpStatus.OK,
      message: 'Google auth URL generated',
      data,
    };
  }

  @ApiOperation({ summary: 'Exchange a Google OAuth code for tokens' })
  @Post('analytics/sellers/google/exchange')
  async googleExchange(
    @Request() req: RequestWithUser,
    @Body() body: { code: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.googleSheetsService.exchangeCode(
      req.user.id,
      body.code,
    );
    return {
      status: HttpStatus.OK,
      message: 'Google account connected',
      data,
    };
  }

  @ApiOperation({ summary: 'Read rows from a Google Sheet for ingest' })
  @Post('analytics/sellers/google/read')
  async googleReadSheet(
    @Request() req: RequestWithUser,
    @Body() body: { spreadsheetId?: string; url?: string; range?: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.googleSheetsService.readSheet(req.user.id, body);
    return {
      status: HttpStatus.OK,
      message: 'Sheet rows fetched successfully',
      data,
    };
  }

  @ApiOperation({
    summary: 'Discover prospect leads via a compliant search source',
  })
  @Get('analytics/acquisition/discover')
  async discover(
    @Request() req: RequestWithUser,
    @Query('source') source?: string,
    @Query('q') q?: string,
    @Query('subreddit') subreddit?: string,
    @Query('sort') sort?: string,
    @Query('time') time?: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const TIMES = ['hour', 'day', 'week', 'month', 'year', 'all'] as const;
    const SOURCES = [
      'reddit',
      'bluesky',
      'youtube',
      'google',
      'twitch',
    ] as const;
    const data = await this.acquisitionService.discover({
      source: (SOURCES as readonly string[]).includes(source ?? '')
        ? (source as (typeof SOURCES)[number])
        : 'reddit',
      query: (q ?? '').trim(),
      subreddit: subreddit?.trim() || undefined,
      sort: sort?.trim() || undefined,
      time: (TIMES as readonly string[]).includes(time ?? '')
        ? (time as (typeof TIMES)[number])
        : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
    return {
      status: HttpStatus.OK,
      message: 'Discovery results fetched successfully',
      data,
    };
  }

  // ----------------------------------------------------------------------
  // Leads pool — persisted discovery results across all sources.
  // ----------------------------------------------------------------------

  @ApiOperation({ summary: 'List the persisted discovery leads pool' })
  @Get('analytics/acquisition/leads')
  async listLeads(
    @Request() req: RequestWithUser,
    @Query('source') source?: string,
    @Query('status') status?: string,
    @Query('intent') intent?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.acquisitionService.listLeads({
      source,
      status,
      intent,
      search,
      sort: sort === 'score' ? 'score' : 'recent',
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      offset: offset ? Number.parseInt(offset, 10) : undefined,
    });
    return {
      status: HttpStatus.OK,
      message: 'Leads fetched successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Qualify unscored leads with Claude (buyer score)' })
  @Post('analytics/acquisition/leads/qualify')
  async qualifyLeads(
    @Request() req: RequestWithUser,
    @Body() body: { limit?: number },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.acquisitionService.qualifyLeads(body?.limit ?? 40);
    return {
      status: HttpStatus.OK,
      message: 'Leads qualified successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Claude query suggestions for a discovery topic' })
  @Post('analytics/acquisition/suggest-queries')
  async suggestQueries(
    @Request() req: RequestWithUser,
    @Body() body: { topic: string; source: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.acquisitionService.suggestQueries(
      body?.topic ?? '',
      body?.source ?? 'reddit',
    );
    return {
      status: HttpStatus.OK,
      message: 'Query suggestions generated',
      data,
    };
  }

  @ApiOperation({ summary: 'Leads pool counts by source + status' })
  @Get('analytics/acquisition/leads/stats')
  async leadStats(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.acquisitionService.leadStats();
    return {
      status: HttpStatus.OK,
      message: 'Lead stats fetched successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Dismiss or restore a lead' })
  @Post('analytics/acquisition/leads/status')
  async setLeadStatus(
    @Request() req: RequestWithUser,
    @Body() body: { source: string; externalId: string; status: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const status = body.status === 'dismissed' ? 'dismissed' : 'new';
    const data = await this.acquisitionService.setLeadStatus(
      body.source,
      body.externalId,
      status,
    );
    return {
      status: HttpStatus.OK,
      message: 'Lead status updated successfully',
      data,
    };
  }

  // ----------------------------------------------------------------------
  // Market / Dealer suite — per-card demand + pricing intelligence.
  // ----------------------------------------------------------------------

  @ApiOperation({ summary: 'Per-card market intelligence table' })
  @Get('analytics/market/cards')
  async listMarketCards(
    @Request() req: RequestWithUser,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.listCards({
      search,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      offset: offset ? Number.parseInt(offset, 10) : undefined,
    });
    return {
      status: HttpStatus.OK,
      message: 'Tracked cards fetched successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Track a new card for market analysis' })
  @Post('analytics/market/cards')
  async addTrackedCard(
    @Request() req: RequestWithUser,
    @Body()
    body: {
      name?: string;
      brand?: string;
      category?: string;
      grade?: string;
      notes?: string;
    },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.addCard(body ?? {}, req.user.id);
    return {
      status: HttpStatus.CREATED,
      message: 'Card is now being tracked',
      data,
    };
  }

  @ApiOperation({ summary: 'Stop tracking a card' })
  @ApiParam({ name: 'id', description: 'Tracked card ID' })
  @Delete('analytics/market/cards/:id')
  async removeTrackedCard(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.removeCard(id);
    return {
      status: HttpStatus.OK,
      message: 'Card is no longer tracked',
      data,
    };
  }

  @ApiOperation({ summary: 'One tracked card' })
  @ApiParam({ name: 'id', description: 'Tracked card ID' })
  @Get('analytics/market/cards/:id')
  async getMarketCard(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.getCard(id);
    return {
      status: HttpStatus.OK,
      message: 'Tracked card fetched successfully',
      data,
    };
  }

  @ApiOperation({ summary: 'Update a holding (cost basis / quantity / date)' })
  @ApiParam({ name: 'id', description: 'Tracked card ID' })
  @Patch('analytics/market/cards/:id/holding')
  async updateHolding(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body()
    body: {
      quantity?: number;
      costBasisUsd?: number | null;
      acquiredAt?: string | null;
      alertAboveUsd?: number | null;
      alertBelowUsd?: number | null;
    },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.updateHolding(id, body ?? {});
    return { status: HttpStatus.OK, message: 'Holding updated', data };
  }

  @ApiOperation({ summary: 'Triggered price alerts across holdings' })
  @Get('analytics/portfolio/alerts')
  async getPortfolioAlerts(
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.alerts();
    return { status: HttpStatus.OK, message: 'Portfolio alerts', data };
  }

  @ApiOperation({ summary: 'Value one tracked card now (code-computed comps)' })
  @ApiParam({ name: 'id', description: 'Tracked card ID' })
  @Post('analytics/market/cards/:id/value')
  async valueTrackedCard(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.valueCard(id, req.user.id);
    return { status: HttpStatus.OK, message: 'Card valued', data };
  }

  @ApiOperation({ summary: 'Portfolio roll-up (cached valuations)' })
  @Get('analytics/portfolio')
  async getPortfolio(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.portfolio();
    return { status: HttpStatus.OK, message: 'Portfolio', data };
  }

  @ApiOperation({ summary: 'Value every holding, then return the roll-up' })
  @Post('analytics/portfolio/value')
  async valuePortfolio(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.valuePortfolio(req.user.id);
    return { status: HttpStatus.OK, message: 'Portfolio valued', data };
  }

  // ---- Sold cards — the realized side of the portfolio ----

  @ApiOperation({ summary: 'Logged sales + realized P/L roll-up' })
  @Get('analytics/portfolio/sold')
  async listSoldCards(
    @Request() req: RequestWithUser,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.soldCardsService.list({
      search,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      offset: offset ? Number.parseInt(offset, 10) : undefined,
    });
    return { status: HttpStatus.OK, message: 'Sold cards', data };
  }

  @ApiOperation({
    summary: 'Log a sale (optionally drawing down the matching holding)',
  })
  @Post('analytics/portfolio/sold')
  async addSoldCard(
    @Request() req: RequestWithUser,
    @Body()
    body: {
      name?: string;
      brand?: string;
      category?: string;
      grade?: string;
      quantity?: number;
      costBasisUsd?: number | null;
      salePriceUsd?: number | null;
      feesUsd?: number | null;
      platform?: string;
      soldAt?: string | null;
      notes?: string;
      trackedCardId?: string | null;
      reduceHolding?: boolean;
    },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.soldCardsService.add(body ?? {}, req.user.id);
    return { status: HttpStatus.CREATED, message: 'Sale logged', data };
  }

  @ApiOperation({ summary: 'Edit a logged sale' })
  @ApiParam({ name: 'id', description: 'Sold card ID' })
  @Patch('analytics/portfolio/sold/:id')
  async updateSoldCard(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      brand?: string;
      category?: string;
      grade?: string;
      quantity?: number;
      costBasisUsd?: number | null;
      salePriceUsd?: number | null;
      feesUsd?: number | null;
      platform?: string;
      soldAt?: string | null;
      notes?: string;
    },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.soldCardsService.update(id, body ?? {});
    return { status: HttpStatus.OK, message: 'Sale updated', data };
  }

  @ApiOperation({ summary: 'Delete a logged sale' })
  @ApiParam({ name: 'id', description: 'Sold card ID' })
  @Delete('analytics/portfolio/sold/:id')
  async removeSoldCard(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.soldCardsService.remove(id);
    return { status: HttpStatus.OK, message: 'Sale deleted', data };
  }

  @ApiOperation({
    summary: 'Pre-warm the valuation cache (showcase set) before a live demo',
  })
  @Post('analytics/valuation/warm')
  async warmValuations(
    @Request() req: RequestWithUser,
    @Body() body: { subjects?: string[] },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.warmValuations(
      body?.subjects,
      req.user.id,
    );
    return { status: HttpStatus.OK, message: 'Valuations warmed', data };
  }

  @ApiOperation({ summary: 'Our logged price history for a card subject' })
  @Get('analytics/valuation/history')
  async valuationHistory(
    @Request() req: RequestWithUser,
    @Query('subject') subject?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketService.valuationHistory(subject ?? '');
    return { status: HttpStatus.OK, message: 'Valuation history', data };
  }

  @ApiOperation({ summary: 'Cached predictive forecast for a card' })
  @ApiParam({ name: 'id', description: 'Prize configuration ID' })
  @Get('analytics/market/cards/:id/forecast')
  async getCardForecast(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.forecastService.getForecast(id);
    return {
      status: HttpStatus.OK,
      message: 'Forecast fetched successfully',
      data,
    };
  }

  @ApiOperation({
    summary: 'Generate/refresh a Claude predictive forecast (web research)',
  })
  @ApiParam({ name: 'id', description: 'Prize configuration ID' })
  @Post('analytics/market/cards/:id/forecast')
  async generateCardForecast(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { refresh?: boolean },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.forecastService.generateForecast(
      id,
      req.user.id,
      !!body?.refresh,
    );
    return {
      status: HttpStatus.OK,
      message: 'Forecast generated successfully',
      data,
    };
  }

  @ApiOperation({ summary: "A card's market profile + historical price series" })
  @Get('analytics/market/cards/:id/profile')
  async getCardProfile(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.cardProfileService.getProfile(id);
    return { status: HttpStatus.OK, message: 'Card market profile', data };
  }

  @ApiOperation({
    summary: 'Refresh a card market profile from all live sources (writes a snapshot)',
  })
  @Post('analytics/market/cards/:id/profile/refresh')
  async refreshCardProfile(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.cardProfileService.refresh(id);
    return {
      status: HttpStatus.OK,
      message: 'Card market profile refreshed',
      data,
    };
  }

  @ApiOperation({ summary: 'Market dashboard catalog (segments + metrics)' })
  @Get('analytics/market-pulse/catalog')
  async marketCatalog(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    return {
      status: HttpStatus.OK,
      message: 'Catalog',
      data: { segments: MARKET_SEGMENTS, metrics: MARKET_METRICS },
    };
  }

  @ApiOperation({ summary: 'Latest market snapshot per segment' })
  @Get('analytics/market-pulse/latest')
  async marketLatest(@Request() req: RequestWithUser): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketPulseService.latestAll();
    return { status: HttpStatus.OK, message: 'Market pulse', data };
  }

  @ApiOperation({ summary: 'Historical market series for a segment' })
  @Get('analytics/market-pulse/:segment/series')
  async marketSeries(
    @Request() req: RequestWithUser,
    @Param('segment') segment: string,
    @Query('days') days?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketPulseService.series(
      segment,
      days ? parseInt(days, 10) : undefined,
    );
    return { status: HttpStatus.OK, message: 'Market series', data };
  }

  @ApiOperation({ summary: 'Refresh (research) a market segment snapshot' })
  @Post('analytics/market-pulse/:segment/refresh')
  async marketRefresh(
    @Request() req: RequestWithUser,
    @Param('segment') segment: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.marketPulseService.refresh(segment, req.user.id);
    return { status: HttpStatus.OK, message: 'Market refreshed', data };
  }

  @ApiOperation({ summary: "This admin's saved market dashboard" })
  @Get('analytics/market-dashboard')
  async getMarketDashboard(
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.dashboardConfigService.get(req.user.id);
    return { status: HttpStatus.OK, message: 'Dashboard', data };
  }

  @ApiOperation({ summary: 'Save this admin market dashboard' })
  @Put('analytics/market-dashboard')
  async saveMarketDashboard(
    @Request() req: RequestWithUser,
    @Body() body: { config?: Record<string, unknown> },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.dashboardConfigService.save(
      req.user.id,
      body?.config ?? {},
    );
    return { status: HttpStatus.OK, message: 'Dashboard saved', data };
  }

  @ApiOperation({ summary: 'Conversational analytics assistant (Insights)' })
  @Post('analytics/insights/chat')
  async insightsChat(
    @Request() req: RequestWithUser,
    @Body()
    body: { messages?: AiChatMessage[]; conversationId?: string; depth?: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.insightsService.chat(
      body?.messages ?? [],
      req.user.id,
      body?.conversationId,
      body?.depth,
    );
    return {
      status: HttpStatus.OK,
      message: 'Insights reply generated',
      data,
    };
  }

  @ApiOperation({ summary: 'Streaming conversational analytics assistant (SSE)' })
  @Post('analytics/insights/chat/stream')
  async insightsChatStream(
    @Request() req: RequestWithUser,
    @Body()
    body: { messages?: AiChatMessage[]; conversationId?: string; depth?: string },
    @Res() res: Response,
  ): Promise<void> {
    if (req.user.role !== UserRole.ADMIN) {
      res.status(HttpStatus.FORBIDDEN).json({ message: 'Admin access required' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    // Swallow write errors so a client disconnect doesn't abort the server-side
    // loop (it still finishes + persists the exchange to history).
    const send = (obj: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      } catch {
        /* client gone */
      }
    };
    // Keepalive comments during quiet gaps (e.g. while web_search runs) so a
    // proxy/load-balancer idle timeout doesn't cut the stream mid-answer.
    const heartbeat = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        /* connection gone */
      }
    }, 15000);
    try {
      const { toolCalls, valuation } = await this.insightsService.chatStream(
        body?.messages ?? [],
        req.user.id,
        {
          onText: (text) => send({ type: 'text', text }),
          onTool: (name) => send({ type: 'tool', name }),
        },
        body?.conversationId,
        body?.depth,
      );
      send({ type: 'done', toolCalls, valuation });
    } catch (e) {
      send({ type: 'error', message: (e as Error).message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  @ApiOperation({ summary: 'Recent deep-dive research jobs (Insights)' })
  @Get('analytics/insights/deep-research')
  async listDeepResearch(
    @Request() req: RequestWithUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.deepResearchService.list(
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
    return { status: HttpStatus.OK, message: 'AI Market Reports', data };
  }

  @ApiOperation({ summary: 'Insights chat history — past conversations' })
  @Get('analytics/insights/history')
  async listInsightsHistory(
    @Request() req: RequestWithUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.insightsHistoryService.listConversations(
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
    return { status: HttpStatus.OK, message: 'Insights history', data };
  }

  @ApiOperation({ summary: 'Rate a Cardy answer (thumbs up/down)' })
  @Post('analytics/insights/feedback')
  async saveInsightsFeedback(
    @Request() req: RequestWithUser,
    @Body()
    body: {
      rating?: 'up' | 'down';
      question?: string;
      answer?: string;
      note?: string;
      subject?: string;
      conversationId?: string;
    },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.insightsHistoryService.saveFeedback({
      rating: body?.rating === 'down' ? 'down' : 'up',
      question: body?.question,
      answer: body?.answer,
      note: body?.note,
      subject: body?.subject,
      conversationId: body?.conversationId,
      adminId: req.user.id,
    });
    return { status: HttpStatus.OK, message: 'Feedback saved', data };
  }

  @ApiOperation({ summary: 'List answer feedback (e.g. thumbs-down for review)' })
  @Get('analytics/insights/feedback')
  async listInsightsFeedback(
    @Request() req: RequestWithUser,
    @Query('rating') rating?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.insightsHistoryService.listFeedback({
      rating: rating === 'up' || rating === 'down' ? rating : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { status: HttpStatus.OK, message: 'Insights feedback', data };
  }

  @ApiOperation({ summary: 'One insights conversation (exchanges)' })
  @Get('analytics/insights/history/:conversationId')
  async getInsightsConversation(
    @Request() req: RequestWithUser,
    @Param('conversationId') conversationId: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data =
      await this.insightsHistoryService.getConversation(conversationId);
    return { status: HttpStatus.OK, message: 'Conversation', data };
  }

  @ApiOperation({
    summary: 'AI usage & estimated cost, by user and prompt type',
  })
  @Get('analytics/usage')
  async getAiUsage(
    @Request() req: RequestWithUser,
    @Query('days') days?: string,
    @Query('userId') userId?: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.claudeUsageService.summary(
      days ? parseInt(days, 10) : 0,
      userId && userId !== 'all' ? userId : undefined,
    );
    return { status: HttpStatus.OK, message: 'AI usage', data };
  }

  @ApiOperation({ summary: 'One deep-dive research job by id' })
  @Get('analytics/insights/deep-research/:id')
  async getDeepResearch(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.deepResearchService.get(id);
    return { status: HttpStatus.OK, message: 'AI Market Report', data };
  }

  @ApiOperation({ summary: 'Start a background deep-dive research job' })
  @Post('analytics/insights/deep-research')
  async startDeepResearch(
    @Request() req: RequestWithUser,
    @Body() body: { subject?: string; depth?: string; imageUrl?: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.deepResearchService.start(
      body?.subject ?? '',
      req.user.id,
      body?.depth,
      body?.imageUrl,
    );
    return { status: HttpStatus.OK, message: 'AI Market Report started', data };
  }

  @ApiOperation({
    summary: 'Identify the card in a photo (no job) — for the confirm step',
  })
  @Post('analytics/insights/deep-research/identify-image')
  async identifyDeepResearchImage(
    @Request() req: RequestWithUser,
    @Body() body: { image?: AiImage; images?: AiImage[]; note?: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const images = body?.images ?? (body?.image ? [body.image] : []);
    const data = await this.deepResearchService.identifyImage(
      images,
      body?.note,
      req.user.id,
    );
    return { status: HttpStatus.OK, message: 'Card identified', data };
  }

  @ApiOperation({
    summary:
      'Identify a card from a text subject + find a reference image — for the verify step',
  })
  @Post('analytics/insights/identify-card')
  async identifyCard(
    @Request() req: RequestWithUser,
    @Body() body: { subject?: string },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.deepResearchService.identifyCard(
      body?.subject ?? '',
      req.user.id,
    );
    return { status: HttpStatus.OK, message: 'Card identified', data };
  }

  @ApiOperation({
    summary: 'Find a reference image for a card subject (bounded web search)',
  })
  @Post('analytics/insights/card-image')
  async findCardImage(
    @Request() req: RequestWithUser,
    @Body()
    body: {
      subject?: string;
      name?: string;
      brand?: string;
      number?: string;
    },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const data = await this.deepResearchService.findCardImage(
      {
        subject: body?.subject ?? '',
        name: body?.name,
        brand: body?.brand,
        number: body?.number,
      },
      req.user.id,
    );
    return { status: HttpStatus.OK, message: 'Card image', data };
  }

  @ApiOperation({ summary: 'Start a deep-dive research job from a card photo' })
  @Post('analytics/insights/deep-research/from-image')
  async startDeepResearchFromImage(
    @Request() req: RequestWithUser,
    @Body()
    body: {
      image?: AiImage;
      images?: AiImage[];
      note?: string;
      depth?: string;
    },
  ): Promise<ApiResponse> {
    this.ensureAdmin(req.user);
    const images = body?.images ?? (body?.image ? [body.image] : []);
    const data = await this.deepResearchService.startFromImage(
      images,
      body?.note,
      req.user.id,
      body?.depth,
    );
    return { status: HttpStatus.OK, message: 'AI Market Report started', data };
  }
}
