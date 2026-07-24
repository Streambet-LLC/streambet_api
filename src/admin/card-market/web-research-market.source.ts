import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../integrations/ai/ai.service';
import { CardMarketReading, CardMarketSource, CardRef } from './card-market.types';

/** One weighted input to the consensus price (for provenance display). */
interface PriceComponent {
  /** e.g. 'eBay sold', 'TCGplayer', '130point', 'PSA 9 comps (analog)'. */
  source: string;
  priceUsd: number | null;
  /** Comps behind this component. */
  sampleSize: number | null;
  /** 0-100 — how much this component drove the consensus. */
  weightPct: number | null;
  /** 'sold' (real exact comps), 'listing', 'guide', or 'analog' (triangulated). */
  kind: 'sold' | 'listing' | 'guide' | 'analog' | string;
  url: string | null;
  note: string | null;
}

interface WebPriceResult {
  medianUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  sampleSize: number | null;
  confidence: 'high' | 'medium' | 'low' | string;
  /** True when the value was triangulated from comparable cards, not exact comps. */
  estimated: boolean;
  /** One line on how the number was derived (comps used or analogs triangulated). */
  basis: string | null;
  /** Per-source weighted inputs that produced the consensus. */
  components: PriceComponent[];
  asOf: string | null;
  note: string | null;
  sources: { title: string; url: string }[];
}

/**
 * Multi-site pricing via Claude web research. In one call Claude searches the
 * open market — eBay sold, TCGplayer, PriceCharting, 130point, etc. — and
 * returns a consensus current price. This is how we cover "as many sources as
 * we can" today without one API integration per site. Billable (web search), so
 * it only runs on an explicit profile refresh.
 */
@Injectable()
export class WebResearchMarketSource implements CardMarketSource {
  readonly key = 'web';
  readonly label = 'Web research (multi-site)';
  private readonly logger = new Logger(WebResearchMarketSource.name);

  constructor(private readonly ai: AiService) {}

  isConfigured(): boolean {
    return this.ai.isConfigured();
  }

  async fetch(card: CardRef): Promise<CardMarketReading | null> {
    const label = [card.name, card.brand, card.category, card.grade]
      .filter(Boolean)
      .join(' · ');
    try {
      const res = await this.ai.research<WebPriceResult>({
        system:
          'You are a trading-card pricing researcher. Determine the CURRENT market value of ONE specific card as a WEIGHTED CONSENSUS across the best available sources, and ALWAYS return a number — never null, never "insufficient data". ' +
          'GATHER from as many sources as you can: eBay recent SOLD/completed listings, TCGplayer, PriceCharting, 130point, reputable price guides, and active listings/Buy-It-Now. ' +
          'WEIGHT BY DATA STRENGTH — cascade downward: (1) recent eBay SOLD comps for the EXACT card+grade with MANY samples get the HIGHEST weight; (2) then other real sold data (130point) and market prices (TCGplayer/PriceCharting); (3) then reputable guides and current asking/BIN listings; (4) then — ONLY if the exact card is thin/absent — TRIANGULATED analogs (same card adjacent grades via the grade multiplier, raw↔graded multiplier, sibling cards in the same set/product, same character/player comparable prints, print-run / PSA-BGS population scarcity). More real recent SOLD comps ⇒ heavier weight and higher confidence; leaning on analogs ⇒ lighter weight and LOW confidence. ' +
          'Compute medianUsd as the WEIGHTED AVERAGE of the components you actually used. Return each component you weighted (its price, sample size, kind, and the % weight you gave it — weights should sum to ~100). Set estimated=false when real exact-match SOLD comps carry most of the weight; estimated=true when analogs do. State the weighting logic in `basis`. Never claim a specific sale you did not find. Output ONLY JSON.',
        prompt: `Card: ${label}.

Return a WEIGHTED-CONSENSUS current value for THIS exact card (match grade if specified). Weight stronger data (many recent eBay sold comps) heaviest and cascade down to analogs only when needed. Return ONLY this JSON (USD, no prose, no code fences):
{
  "medianUsd": <weighted-average current value, number — required, never null>,
  "lowUsd": <low end of the range, number or null>,
  "highUsd": <high end of the range, number or null>,
  "sampleSize": <total exact-match SOLD comps you saw (0 if none), integer>,
  "confidence": "high" | "medium" | "low",
  "estimated": <true if analogs carry most of the weight, false if real exact-match comps do>,
  "basis": "<one short line on the weighting, e.g. 'weighted avg: 8 eBay PSA 10 solds (70%) + TCGplayer market (20%) + 2 listings (10%)'>",
  "components": [
    { "source": "<e.g. eBay sold / TCGplayer / 130point / PSA 9 comps (analog)>", "priceUsd": <number>, "sampleSize": <int or null>, "weightPct": <0-100>, "kind": "sold"|"listing"|"guide"|"analog", "url": "<url or null>", "note": "<optional short note>" }
  ],
  "asOf": "<YYYY-MM-DD of the freshest data you used, or null>",
  "note": "<one short sentence on the read, or null>",
  "sources": [ { "title": "<site/source>", "url": "<url>" } ]
}`,
        maxTokens: 8000,
        meta: { feature: 'card_profile' },
      });

      const low = this.num(res.lowUsd);
      const high = this.num(res.highUsd);
      const components = this.cleanComponents(res.components);
      // Prefer the model's weighted median; else recompute it from component
      // weights; else fall back to the range midpoint. Never drop the read.
      const median =
        this.num(res.medianUsd) ??
        this.weightedAvg(components) ??
        (low != null && high != null ? (low + high) / 2 : (low ?? high));
      if (median == null && low == null && high == null) return null;
      const estimated = res.estimated === true;
      return {
        medianUsd: median,
        lowUsd: low,
        highUsd: high,
        avgUsd: median,
        sampleCount: this.int(res.sampleSize),
        currency: 'USD',
        meta: {
          confidence: res.confidence ?? (estimated ? 'low' : null),
          estimated,
          basis: res.basis ?? null,
          components,
          asOf: res.asOf ?? null,
          note: res.note ?? null,
          sources: Array.isArray(res.sources) ? res.sources.slice(0, 8) : [],
        },
      };
    } catch (e) {
      this.logger.warn(`Web pricing failed for ${label}: ${(e as Error).message}`);
      return null;
    }
  }

  private num(v: unknown): number | null {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  private int(v: unknown): number | null {
    const n = this.num(v);
    return n == null ? null : Math.round(n);
  }

  /** Sanitize + cap the model's weighted components for storage/display. */
  private cleanComponents(raw: unknown): PriceComponent[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .slice(0, 10)
      .map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const source = typeof o.source === 'string' ? o.source.slice(0, 80) : '';
        const price = this.num(o.priceUsd);
        if (!source || price == null) return null;
        return {
          source,
          priceUsd: price,
          sampleSize: this.int(o.sampleSize),
          weightPct: this.num(o.weightPct),
          kind: typeof o.kind === 'string' ? o.kind : 'sold',
          url: typeof o.url === 'string' ? o.url : null,
          note: typeof o.note === 'string' ? o.note.slice(0, 160) : null,
        } as PriceComponent;
      })
      .filter((c): c is PriceComponent => c !== null);
  }

  /** Weighted average of components (by weightPct); null if none usable. */
  private weightedAvg(components: PriceComponent[]): number | null {
    let wsum = 0;
    let acc = 0;
    for (const c of components) {
      if (c.priceUsd == null) continue;
      const w = c.weightPct != null && c.weightPct > 0 ? c.weightPct : 1;
      acc += c.priceUsd * w;
      wsum += w;
    }
    return wsum > 0 ? acc / wsum : null;
  }
}
