import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketSnapshot } from './entities/market-snapshot.entity';
import { AiService } from '../integrations/ai/ai.service';
import { DashboardConfigService } from './dashboard-config.service';

/** Market segments the dashboard can chart. */
export const MARKET_SEGMENTS = [
  { key: 'pokemon', label: 'Pokémon' },
  { key: 'one_piece', label: 'One Piece' },
  { key: 'sports', label: 'Sports' },
  { key: 'magic', label: 'Magic' },
  { key: 'lorcana', label: 'Lorcana' },
  { key: 'all', label: 'All TCG' },
] as const;

/** The market indices we track — all 0-100 AI estimates. */
export const MARKET_METRICS = [
  { key: 'heat', label: 'Market heat', help: 'Overall activity & demand' },
  { key: 'momentum', label: 'Price momentum', help: 'Recent direction (50 = flat)' },
  { key: 'sentiment', label: 'Sentiment', help: 'Community / social sentiment' },
  { key: 'demand', label: 'Demand', help: 'Buy-side pressure' },
  { key: 'supply', label: 'Supply pressure', help: 'New supply / reprints (higher = more)' },
  { key: 'grading', label: 'Grading activity', help: 'PSA/BGS submissions & pop growth' },
  { key: 'sealed', label: 'Sealed strength', help: 'Sealed product demand' },
  { key: 'volatility', label: 'Volatility', help: 'Price choppiness' },
] as const;

const SEGMENT_KEYS = new Set(MARKET_SEGMENTS.map((s) => s.key));
const METRIC_KEYS = MARKET_METRICS.map((m) => m.key);

export interface MarketSnapshotDto {
  id: string;
  segment: string;
  capturedAt: string;
  metrics: Record<string, number>;
  summary: string | null;
  highlights: string[] | null;
  sources: { title: string; url: string }[] | null;
}

interface PulseResult {
  metrics: Record<string, number>;
  summary: string;
  highlights: string[];
  sources: { title: string; url: string }[];
}

/**
 * Researches the broader hobby market per segment (Claude + live web search)
 * and stores a snapshot of 0-100 market indices. Snapshots accrue into a
 * historical series charted on the market dashboard.
 */
@Injectable()
export class MarketPulseService {
  private readonly logger = new Logger(MarketPulseService.name);

  constructor(
    @InjectRepository(MarketSnapshot)
    private readonly repo: Repository<MarketSnapshot>,
    private readonly ai: AiService,
    private readonly dashboards: DashboardConfigService,
  ) {}

  private label(segment: string): string {
    return MARKET_SEGMENTS.find((s) => s.key === segment)?.label ?? segment;
  }

  /** Research + store a fresh snapshot for one segment. */
  async refresh(segment: string): Promise<MarketSnapshotDto> {
    if (!SEGMENT_KEYS.has(segment as never)) {
      throw new BadRequestException('Unknown market segment.');
    }
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    const label = this.label(segment);
    const metricLines = MARKET_METRICS.map(
      (m) => `  "${m.key}": <0-100 — ${m.help}>`,
    ).join(',\n');

    const res = await this.ai.research<PulseResult>({
      system:
        'You are a senior trading-card market analyst. Assess the CURRENT state of a collectibles market segment using live web search — recent sold prices and indices, social sentiment, upcoming set/product releases, PSA/BGS grading trends, reprint/supply news, and sealed demand. Return calibrated 0-100 index estimates (higher = stronger/more), a short summary, and notable movers. Be honest about uncertainty. Output ONLY a JSON object.',
      prompt: `Market segment: ${label} trading cards.

Return ONLY this JSON (no prose, no code fences):
{
  "metrics": {
${metricLines}
  },
  "summary": "<2-3 sentence state-of-the-market>",
  "highlights": ["<notable mover / hot card / news>", "..."],
  "sources": [ { "title": "<source>", "url": "<url>" } ]
}`,
      // A market index read is a quick pulse, not a deep report — keep it
      // cheap: fewer searches, less thinking, tighter output cap.
      maxTokens: 3500,
      maxSearches: 4,
      effort: 'low',
    });

    const metrics: Record<string, number> = {};
    for (const k of METRIC_KEYS) {
      const v = Number((res.metrics ?? {})[k]);
      if (Number.isFinite(v)) metrics[k] = Math.max(0, Math.min(100, Math.round(v)));
    }

    const now = new Date();
    const saved = await this.repo.save(
      this.repo.create({
        segment,
        capturedAt: now,
        metrics,
        summary: res.summary ?? null,
        highlights: Array.isArray(res.highlights)
          ? res.highlights.slice(0, 8)
          : null,
        sources: Array.isArray(res.sources) ? res.sources.slice(0, 8) : null,
      }),
    );
    return this.toDto(saved);
  }

  /**
   * Auto-refresh once a day so trend lines fill in without a manual pull. To
   * avoid burning credits on markets nobody looks at, we refresh ONLY the
   * segments referenced in a saved dashboard (falling back to a small default
   * set when none exist yet). Runs sequentially so we don't fire many
   * web-research calls at once; each segment is isolated so one failure doesn't
   * stop the rest.
   */
  @Cron('0 6 * * *', { timeZone: 'America/Los_Angeles' })
  async dailyRefresh(): Promise<void> {
    if (!this.ai.isConfigured()) return;
    const used = await this.dashboards.usedSegments();
    const targets = (used.length ? used : ['pokemon', 'sports', 'all']).filter(
      (s) => SEGMENT_KEYS.has(s as never),
    );
    this.logger.log(
      `Daily market refresh starting… (${targets.length} segment(s): ${targets.join(', ')})`,
    );
    for (const key of targets) {
      try {
        await this.refresh(key);
      } catch (e) {
        this.logger.warn(`Daily refresh ${key} failed: ${(e as Error).message}`);
      }
    }
    this.logger.log('Daily market refresh done.');
  }

  /** Historical series for one segment (oldest first). */
  async series(segment: string, sinceDays?: number): Promise<MarketSnapshotDto[]> {
    try {
      const qb = this.repo
        .createQueryBuilder('m')
        .where('m.segment = :segment', { segment })
        .orderBy('m.capturedAt', 'ASC')
        .take(500);
      if (sinceDays && sinceDays > 0) {
        const cutoff = new Date(Date.now() - sinceDays * 86400000);
        qb.andWhere('m.capturedAt >= :cutoff', { cutoff });
      }
      const rows = await qb.getMany();
      return rows.map((r) => this.toDto(r));
    } catch (e) {
      this.logger.warn(`market series failed: ${(e as Error).message}`);
      return [];
    }
  }

  /** Latest snapshot per segment. */
  async latestAll(): Promise<MarketSnapshotDto[]> {
    try {
      const rows = (await this.repo.query(
        `SELECT DISTINCT ON (segment) *
         FROM market_snapshots
         ORDER BY segment, "capturedAt" DESC`,
      )) as MarketSnapshot[];
      return rows.map((r) => this.toDto(r));
    } catch (e) {
      this.logger.warn(`market latest failed: ${(e as Error).message}`);
      return [];
    }
  }

  private toDto(s: MarketSnapshot): MarketSnapshotDto {
    return {
      id: s.id,
      segment: s.segment,
      capturedAt:
        s.capturedAt instanceof Date
          ? s.capturedAt.toISOString()
          : new Date(s.capturedAt).toISOString(),
      metrics: s.metrics ?? {},
      summary: s.summary ?? null,
      highlights: s.highlights ?? null,
      sources: s.sources ?? null,
    };
  }
}
