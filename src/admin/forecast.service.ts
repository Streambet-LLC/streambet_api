import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CardForecast } from './entities/card-forecast.entity';
import { MarketService } from './market.service';
import { AiService } from '../integrations/ai/ai.service';
import {
  AnswerDepth,
  DEEP_DIVE_DEPTH,
  normalizeDepth,
} from '../integrations/ai/answer-depth';
import {
  ValComp,
  ValMethod,
  computeValuation,
} from './card-market/valuation.util';

/** The structured forecast Claude returns (stored verbatim). */
export interface CardForecastData {
  outlook: 'Bullish' | 'Neutral' | 'Bearish' | string;
  confidence: number;
  horizon: string;
  thesis: string;
  /** The card's estimated value + range (as of asOf date). */
  valueEstimate?: { pointUsd: number; lowUsd: number; highUsd: number; asOf: string };
  /** Which valuation route produced valueEstimate. */
  method?: 'anchor-and-adjust' | 'recent-median' | 'triangulation' | string;
  /** The most-recent confirmed sale we anchored on. */
  anchorComp?: { priceUsd: number; date: string; sourceType: string; url: string };
  /** The comps actually used in the valuation. */
  compsUsed?: { priceUsd: number; date: string; grade: string; sourceType: string; url: string }[];
  /** Index move applied for the anchor-and-adjust route. */
  indexAdjustment?: { index: string; movePct: number; window: string } | null;
  /** Evidence-tied confidence in the valuation (distinct from outlook confidence). */
  valuationConfidence?: { pct: number; basis: string };
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
  sources: { title: string; type?: string; url: string }[];
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
    'You are a senior trading-card investment analyst. Produce a rigorous, calibrated predictive intelligence brief for ONE subject — a specific card, player, or set. GROUNDING CONTRACT (non-negotiable): never state a sale or market price you did not retrieve from a web_search result this run; every price you cite must carry a real URL and a date; if you generate or reference a sold-comps search link (eBay SOLD, PSA sales history, 130point) you MUST read and cite the individual comps in it before using it — a bare search link is not a valuation; confirm each comp is the SAME card (player/character, set, parallel, number, year, grade); and TYPE every source as exactly one of auction-sale, private-sale, marketplace-listing (an active ask, not a sale), price-guide, or index (never call a marketplace like Fanatics Collect a price guide). FIRST CLASSIFY THE CARD, then pick the valuation route: (a) LOW-POP / HIGH-VALUE with few-but-recent comps (it will not be on eBay) -> use the PSA spec + sales-history page and a player/segment index (e.g. Card Ladder); ANCHOR on the single MOST RECENT confirmed sale, then ADJUST by the index move since that sale date (anchor x (1 +/- index move) = estimate) and give a tight range for scarcity; (b) LIQUID with many recent solds -> trimmed median of the most recent eBay SOLD comps (drop outliers), and USE the comps in your own search link; (c) ULTRA-TRADED low-value -> recent median, high confidence; (d) BRAND-NEW / NO comps or (e) UNTRADED 1-of-1 -> only THEN triangulate from analogs (adjacent grades x grade multiplier, raw<->graded, sibling parallels, same player comparable prints, pop scarcity) as a clearly-labeled LOW-confidence estimate. Do NOT triangulate when direct recent comps exist, and never anchor on a stale or mid-pack sale when a newer one exists. Gather in parallel: recent news + social sentiment; upcoming catalysts; PSA/BGS population and policy trends; print-run / reprint / supply news; and historical PRECEDENTS. Assess an overall CardCade RATING (0-100 + label), a LIQUIDITY score, the PRICE TRAJECTORY, and the LIKELY BUYERS. Make CONFIDENCE a function of (# recent comps, recency of the newest, price dispersion): many tight recent comps -> high; one/old/index-adjusted comp -> ~60-72; analogs only -> low. For sell-timing give DATA-CENTRIC probabilistic scenarios (days-to-catalyst; P(up)/P(base)/P(down) summing to 100 with % moves and an expected value), not "could go up or down". If you hit the search budget, answer from the comps already retrieved — never degrade to "not enough data". Output ONLY a JSON object.';

  private readonly FORECAST_JSON = `Return ONLY this JSON (no prose, no code fences):
{
  "outlook": "Bullish" | "Neutral" | "Bearish",
  "confidence": <0-100 integer>,
  "horizon": "<e.g. 3-6 months>",
  "thesis": "<2-3 sentence summary of the call>",
  "valueEstimate": { "pointUsd": <number>, "lowUsd": <number>, "highUsd": <number>, "asOf": "<YYYY-MM-DD>" },
  "method": "anchor-and-adjust" | "recent-median" | "triangulation",
  "anchorComp": { "priceUsd": <number>, "date": "<YYYY-MM-DD>", "sourceType": "auction-sale"|"private-sale"|"marketplace-listing"|"price-guide"|"index", "url": "<retrieved url>" },
  "compsUsed": [ { "priceUsd": <number>, "date": "<YYYY-MM-DD>", "grade": "<e.g. PSA 10>", "sourceType": "auction-sale"|"private-sale"|"marketplace-listing"|"price-guide"|"index", "url": "<retrieved url>" } ],
  "indexAdjustment": { "index": "<e.g. Card Ladder Patrick Mahomes>", "movePct": <number>, "window": "<since anchor date>" },
  "valuationConfidence": { "pct": <0-100 integer>, "basis": "<n recent comps, recency, dispersion>" },
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
  "sources": [ { "title": "<source>", "type": "auction-sale"|"private-sale"|"marketplace-listing"|"price-guide"|"index"|"news", "url": "<retrieved url>" } ]
}`;

  constructor(
    @InjectRepository(CardForecast)
    private readonly repo: Repository<CardForecast>,
    private readonly market: MarketService,
    private readonly ai: AiService,
  ) {}

  /**
   * Recompute the forecast's price + confidence from the comps/anchor/index the
   * model retrieved, in CODE — so the number is deterministic and not an LLM
   * arithmetic slip. Leaves the qualitative brief (thesis, catalysts, etc.)
   * exactly as the analyst wrote it. No-op for older forecasts that predate the
   * structured valuation fields.
   */
  private applyDeterministicValuation(f: CardForecastData): CardForecastData {
    const methods: ValMethod[] = [
      'anchor-and-adjust',
      'recent-median',
      'triangulation',
    ];
    if (!f.method || !methods.includes(f.method as ValMethod)) return f;
    const today = new Date().toISOString().slice(0, 10);
    const toComp = (c?: {
      priceUsd: number;
      date: string;
      grade?: string;
      sourceType: string;
      url: string;
    }): ValComp | null =>
      c && typeof c.priceUsd === 'number'
        ? {
            priceUsd: c.priceUsd,
            date: c.date ?? null,
            grade: c.grade ?? null,
            sourceType: (c.sourceType ?? '').toLowerCase(),
            url: c.url ?? null,
          }
        : null;

    const out = computeValuation({
      method: f.method as ValMethod,
      anchorComp: toComp(f.anchorComp as never),
      compsUsed: (f.compsUsed ?? [])
        .map(c => toComp(c as never))
        .filter((c): c is ValComp => c !== null),
      indexMovePct:
        typeof f.indexAdjustment?.movePct === 'number'
          ? f.indexAdjustment.movePct
          : null,
      modelPoint: f.valueEstimate?.pointUsd ?? null,
      modelLow: f.valueEstimate?.lowUsd ?? null,
      modelHigh: f.valueEstimate?.highUsd ?? null,
      today,
    });

    if (out.pointUsd != null) {
      f.valueEstimate = {
        pointUsd: out.pointUsd,
        lowUsd: out.lowUsd ?? out.pointUsd,
        highUsd: out.highUsd ?? out.pointUsd,
        asOf: f.valueEstimate?.asOf ?? today,
      };
    }
    f.valuationConfidence = { pct: out.confidencePct, basis: out.confidenceBasis };
    return f;
  }

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
    rawDepth?: unknown,
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

    // Tracked-card lookup — display fields only. All pricing/demand evidence
    // comes from live web research (the marketplace signal feed was retired).
    const card = await this.market.getCardRef(cardId);

    const preset = DEEP_DIVE_DEPTH[normalizeDepth(rawDepth)];
    const forecast = await this.ai.research<CardForecastData>({
      system: this.ANALYST_SYSTEM,
      prompt: `Card: ${card.name} (${card.brand ?? '?'} / ${card.category ?? '?'}${
        card.grade ? `, grade ${card.grade}` : ''
      }).

${this.FORECAST_JSON}`,
      maxTokens: preset.maxTokens,
      maxSearches: preset.maxSearches,
      effort: preset.effort,
      meta: { feature: 'card_forecast', adminId },
    });
    this.applyDeterministicValuation(forecast);

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
  async researchSubject(
    subject: string,
    adminId?: string,
    rawDepth?: unknown,
  ): Promise<CardForecastData> {
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    const depth: AnswerDepth = normalizeDepth(rawDepth);
    const preset = DEEP_DIVE_DEPTH[depth];
    const forecast = await this.ai.research<CardForecastData>({
      system: this.ANALYST_SYSTEM,
      prompt: `Subject: ${subject}.

${this.FORECAST_JSON}`,
      maxTokens: preset.maxTokens,
      maxSearches: preset.maxSearches,
      effort: preset.effort,
      meta: { feature: 'deep_dive', adminId },
    });
    return this.applyDeterministicValuation(forecast);
  }
}
