import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CardForecast } from './entities/card-forecast.entity';
import { MarketService } from './market.service';
import { AiService } from '../integrations/ai/ai.service';

/** The structured forecast Claude returns (stored verbatim). */
export interface CardForecastData {
  outlook: 'Bullish' | 'Neutral' | 'Bearish' | string;
  confidence: number;
  horizon: string;
  thesis: string;
  /** Overall CardCade rating — the single-number take. */
  rating?: {
    score: number; // 0-100
    label: string; // e.g. Strong Buy | Buy | Hold | Watch | Avoid
    rationale: string;
  };
  /** How easily/quickly it sells. */
  liquidity?: {
    score: number; // 0-100
    level: 'High' | 'Medium' | 'Low' | string;
    note: string;
  };
  /** Where the price is heading. */
  priceTrajectory?: {
    direction: 'Rising' | 'Stable' | 'Falling' | string;
    note: string;
  };
  /** Who is most likely to buy this. */
  likelyBuyers?: {
    profile: string;
    archetypes: string[];
  };
  socialBuzz: { level: string; summary: string };
  catalysts: {
    event: string;
    probabilityPct: number;
    direction: 'up' | 'down' | string;
    magnitude: 'small' | 'moderate' | 'large' | string;
    note: string;
  }[];
  precedents: { comparable: string; outcome: string }[];
  macroFactors: { factor: string; note: string }[];
  risks: { risk: string; note: string }[];
  suggestedAction: string;
  sources: { title: string; url: string }[];
}

/**
 * Predictive card intelligence: Claude fuses our owned market signals with
 * live web research (social buzz, upcoming events, grading/supply news,
 * comparable precedents) into a structured, scenario-weighted forecast.
 */
@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  private readonly ANALYST_SYSTEM =
    'You are a senior trading-card investment analyst. Produce a rigorous, calibrated predictive intelligence brief for ONE subject — a specific card, player, or set. Use web search to gather: recent news + social sentiment about the player/character/set; upcoming catalysts (games, playoffs, tournaments, set releases, anniversaries); PSA/BGS grading population trends and policy changes; print-run / reprint / supply news; and historical PRECEDENTS — how comparable cards performed through similar events. If platform signals are provided, fuse them in. Estimate each catalyst’s probability and directional price impact. Also assess: an overall CardCade RATING (0-100 + a label), a LIQUIDITY score (0-100 — how easily/quickly it sells), the PRICE TRAJECTORY (rising/stable/falling), and the LIKELY BUYERS (who collects this and why). Separate signal from hype; be honest about uncertainty. Output ONLY a JSON object.';

  private readonly FORECAST_JSON = `Return ONLY this JSON (no prose, no code fences):
{
  "outlook": "Bullish" | "Neutral" | "Bearish",
  "confidence": <0-100 integer>,
  "horizon": "<e.g. 3-6 months>",
  "thesis": "<2-3 sentence summary of the call>",
  "rating": { "score": <0-100 integer>, "label": "Strong Buy"|"Buy"|"Hold"|"Watch"|"Avoid", "rationale": "<one sentence>" },
  "liquidity": { "score": <0-100 integer>, "level": "High"|"Medium"|"Low", "note": "<why — supply, sales velocity, demand depth>" },
  "priceTrajectory": { "direction": "Rising"|"Stable"|"Falling", "note": "<near-term price direction and why>" },
  "likelyBuyers": { "profile": "<1-2 sentences on who is most likely to buy this>", "archetypes": ["<short buyer type>", "..."] },
  "socialBuzz": { "level": "High"|"Medium"|"Low", "summary": "<recent mention/sentiment summary>" },
  "catalysts": [ { "event": "<upcoming event/scenario>", "probabilityPct": <0-100>, "direction": "up"|"down", "magnitude": "small"|"moderate"|"large", "note": "<why>" } ],
  "precedents": [ { "comparable": "<comparable card + event>", "outcome": "<what happened to its price>" } ],
  "macroFactors": [ { "factor": "<grading/supply/reprint/market factor>", "note": "<impact>" } ],
  "risks": [ { "risk": "<downside risk>", "note": "<why>" } ],
  "suggestedAction": "<concise action for a dealer/holder>",
  "sources": [ { "title": "<source>", "url": "<url>" } ]
}`;

  constructor(
    @InjectRepository(CardForecast)
    private readonly repo: Repository<CardForecast>,
    private readonly market: MarketService,
    private readonly ai: AiService,
  ) {}

  /** Cached forecast for a card, or null if none yet. */
  async getForecast(
    cardId: string,
  ): Promise<{ forecast: CardForecastData; generatedAt: string } | null> {
    const row = await this.repo.findOne({
      where: { prizeConfigurationId: cardId },
    });
    if (!row) return null;
    return {
      forecast: row.forecast as unknown as CardForecastData,
      generatedAt: row.generatedAt.toISOString(),
    };
  }

  /** Generate (or refresh) a forecast: gather signals → Claude web research. */
  async generateForecast(
    cardId: string,
    adminId?: string,
    refresh = false,
  ): Promise<{ forecast: CardForecastData; generatedAt: string }> {
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    if (!refresh) {
      const cached = await this.getForecast(cardId);
      if (cached) return cached;
    }

    const { card, recentComps } = await this.market.getCardSignals(cardId);
    const signals = {
      name: card.name,
      brand: card.brand,
      category: card.category,
      grade: card.grade,
      ourPriceUsd: card.price,
      marketMedianUsd: card.comps?.median ?? null,
      marketRangeUsd:
        card.comps?.min != null && card.comps?.max != null
          ? [card.comps.min, card.comps.max]
          : null,
      priceGapPct: card.priceGapPct,
      vsMarketPct: card.vsMarketPct,
      lifetimeSales: card.sales,
      distinctBuyers: card.buyers,
      buyerConcentrationPct: card.concentrationPct,
      liquidity: card.liquidity,
      stockOnHand: card.stock,
      whaleBoughtRecently: card.whaleRecent,
      recentSoldComps: recentComps
        .slice(0, 6)
        .map((c) => ({ priceUsd: c.price, soldAt: c.soldAt })),
    };

    const forecast = await this.ai.research<CardForecastData>({
      system: this.ANALYST_SYSTEM,
      prompt: `Card: ${card.name} (${card.brand ?? '?'} / ${card.category ?? '?'}${
        card.grade ? `, grade ${card.grade}` : ''
      }).

Platform signals (our marketplace demand + eBay sold comps):
${JSON.stringify(signals, null, 2)}

${this.FORECAST_JSON}`,
      maxTokens: 8000,
    });

    const now = new Date();
    const existing = await this.repo.findOne({
      where: { prizeConfigurationId: cardId },
    });
    if (existing) {
      existing.forecast = forecast as unknown as Record<string, unknown>;
      existing.generatedAt = now;
      existing.generatedByAdminId = adminId ?? existing.generatedByAdminId;
      await this.repo.save(existing);
    } else {
      await this.repo.save(
        this.repo.create({
          prizeConfigurationId: cardId,
          forecast: forecast as unknown as Record<string, unknown>,
          generatedAt: now,
          generatedByAdminId: adminId ?? null,
        }),
      );
    }
    return { forecast, generatedAt: now.toISOString() };
  }

  /**
   * Generic predictive brief for ANY card/player/set by free-text subject —
   * no marketplace catalog or internal signals required. Pure live web
   * research. Powers the generic Insights assistant.
   */
  async researchSubject(subject: string): Promise<CardForecastData> {
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    return this.ai.research<CardForecastData>({
      system: this.ANALYST_SYSTEM,
      prompt: `Subject: ${subject}.

${this.FORECAST_JSON}`,
      maxTokens: 8000,
    });
  }
}
