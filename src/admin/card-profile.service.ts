import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CardMarketSnapshot } from './entities/card-market-snapshot.entity';
import { CardMarketSource, CardRef } from './card-market/card-market.types';
import { EbayMarketSource } from './card-market/ebay-market.source';
import { WebResearchMarketSource } from './card-market/web-research-market.source';

export interface CardMarketSourceMeta {
  key: string;
  label: string;
  configured: boolean;
  note?: string;
}

export interface CardMarketPoint {
  source: string;
  capturedAt: string;
  medianUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  avgUsd: number | null;
  sampleCount: number | null;
}

export interface CardMarketLatest extends CardMarketPoint {
  meta: Record<string, unknown> | null;
}

export interface CardMarketProfile {
  cardId: string;
  name: string;
  brand: string | null;
  category: string | null;
  grade: string | null;
  sources: CardMarketSourceMeta[];
  latest: CardMarketLatest[];
  history: CardMarketPoint[];
  consensusMedianUsd: number | null;
  updatedAt: string | null;
}

/**
 * Builds and maintains a per-card market profile: current pricing from every
 * configured source plus the full historical series we chart. Each refresh runs
 * the live sources and appends a snapshot per source, so history accrues over
 * time. Dormant sources (awaiting API keys) are advertised but not run.
 */
@Injectable()
export class CardProfileService {
  private readonly logger = new Logger(CardProfileService.name);
  private readonly sources: CardMarketSource[];

  constructor(
    @InjectRepository(CardMarketSnapshot)
    private readonly repo: Repository<CardMarketSnapshot>,
    private readonly dataSource: DataSource,
    private readonly ebay: EbayMarketSource,
    private readonly web: WebResearchMarketSource,
  ) {
    this.sources = [this.ebay, this.web];
  }

  /** Sources shown in the UI — live (run on refresh) + declared-dormant. */
  private sourcesMeta(): CardMarketSourceMeta[] {
    return [
      {
        key: this.ebay.key,
        label: this.ebay.label,
        configured: this.ebay.isConfigured(),
        note: 'Populated by the eBay sync (needs eBay API credentials + a sync run).',
      },
      {
        key: this.web.key,
        label: this.web.label,
        configured: this.web.isConfigured(),
        note: 'Claude searches eBay, TCGplayer, PriceCharting, 130point and more at refresh time.',
      },
      {
        key: 'tcgplayer',
        label: 'TCGplayer',
        configured: false,
        note: 'Official-API connector — activates when a TCGplayer API key is added.',
      },
      {
        key: 'pricecharting',
        label: 'PriceCharting',
        configured: false,
        note: 'Official-API connector — activates when a PriceCharting token is added.',
      },
      {
        key: 'psa',
        label: 'PSA population',
        configured: false,
        note: 'Graded-supply signal (cert/pop based) — planned connector.',
      },
    ];
  }

  private async loadCard(cardId: string): Promise<CardRef> {
    const rows = (await this.dataSource.query(
      `SELECT id, name, brand, category, grade
       FROM prize_configurations WHERE id = $1 LIMIT 1`,
      [cardId],
    )) as CardRef[];
    if (!rows[0]) throw new NotFoundException('Card not found.');
    return rows[0];
  }

  /** Read the stored profile (cached snapshots) — no external calls. */
  async getProfile(cardId: string): Promise<CardMarketProfile> {
    const card = await this.loadCard(cardId);
    const snaps = await this.repo.find({
      where: { prizeConfigurationId: cardId },
      order: { capturedAt: 'ASC' },
      take: 2000,
    });

    const history: CardMarketPoint[] = snaps.map((s) => ({
      source: s.source,
      capturedAt: s.capturedAt.toISOString(),
      medianUsd: s.medianUsd,
      lowUsd: s.lowUsd,
      highUsd: s.highUsd,
      avgUsd: s.avgUsd,
      sampleCount: s.sampleCount,
    }));

    // Latest snapshot per source.
    const latestBySource = new Map<string, CardMarketSnapshot>();
    for (const s of snaps) {
      const prev = latestBySource.get(s.source);
      if (!prev || s.capturedAt > prev.capturedAt) latestBySource.set(s.source, s);
    }
    const latest: CardMarketLatest[] = [...latestBySource.values()]
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
      .map((s) => ({
        source: s.source,
        capturedAt: s.capturedAt.toISOString(),
        medianUsd: s.medianUsd,
        lowUsd: s.lowUsd,
        highUsd: s.highUsd,
        avgUsd: s.avgUsd,
        sampleCount: s.sampleCount,
        meta: s.meta,
      }));

    const medians = latest
      .map((l) => l.medianUsd)
      .filter((n): n is number => typeof n === 'number');
    const consensusMedianUsd = medians.length
      ? Math.round(
          (medians.reduce((a, b) => a + b, 0) / medians.length) * 100,
        ) / 100
      : null;

    const updatedAt = snaps.length
      ? snaps[snaps.length - 1].capturedAt.toISOString()
      : null;

    return {
      cardId,
      name: card.name,
      brand: card.brand,
      category: card.category,
      grade: card.grade,
      sources: this.sourcesMeta(),
      latest,
      history,
      consensusMedianUsd,
      updatedAt,
    };
  }

  /**
   * Run every configured live source, append a snapshot per non-null reading,
   * then return the refreshed profile. Sources run in parallel and failures are
   * isolated so one bad source can't sink the refresh.
   */
  async refresh(cardId: string): Promise<CardMarketProfile> {
    const card = await this.loadCard(cardId);
    const capturedAt = new Date();

    const readings = await Promise.all(
      this.sources.map(async (src) => {
        if (!src.isConfigured()) return null;
        try {
          const reading = await src.fetch(card);
          return reading ? { src, reading } : null;
        } catch (e) {
          this.logger.warn(
            `Source "${src.key}" failed for ${card.name}: ${(e as Error).message}`,
          );
          return null;
        }
      }),
    );

    const toSave = readings
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map(({ src, reading }) =>
        this.repo.create({
          prizeConfigurationId: cardId,
          source: src.key,
          capturedAt,
          currency: reading.currency ?? 'USD',
          medianUsd: reading.medianUsd,
          lowUsd: reading.lowUsd,
          highUsd: reading.highUsd,
          avgUsd: reading.avgUsd,
          sampleCount: reading.sampleCount,
          meta: reading.meta ?? null,
        }),
      );
    if (toSave.length) await this.repo.save(toSave);

    return this.getProfile(cardId);
  }
}
