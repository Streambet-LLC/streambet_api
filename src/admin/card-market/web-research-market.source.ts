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
  /** Observation date (YYYY-MM-DD) of this component, when known. */
  date: string | null;
  /** 'sold'/'auction' (real exact comps), 'listing' (ask), 'guide', 'index', or 'analog'. */
  kind: 'sold' | 'auction' | 'listing' | 'guide' | 'index' | 'analog';
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
          'You are a trading-card pricing researcher. Determine the CURRENT market value of ONE specific card and return it as JSON. GROUNDING CONTRACT: never state a sale/price you did not retrieve from a web_search result this run; every priced component MUST carry a real retrieved url and a date; confirm each comp is the SAME card+grade; and TYPE each component correctly (sold/auction-sale, listing = an active ask NOT a sale, guide, index, or analog) — never mislabel a marketplace listing or a sale as a price guide. ' +
          'FIRST decide the route from the data you find: (1) LIQUID (many recent SOLD comps for the exact card+grade) -> medianUsd = TRIMMED MEDIAN of the most RECENT solds (drop outliers), estimated=false, high confidence; (2) THIN / HIGH-VALUE (few but real recent sales, likely on PSA sales-history not eBay) -> ANCHOR on the single MOST RECENT confirmed sale, then adjust by the relevant player/segment index move since that sale date, and report the anchor + index move; (3) NO direct comps -> ONLY THEN triangulate from analogs (adjacent grades via grade multiplier, raw<->graded, sibling parallels, same player comparable prints, pop scarcity), estimated=true, LOW confidence. ' +
          'Do NOT triangulate when real recent comps exist, and NEVER anchor on a stale or mid-pack sale when a newer dated sale exists. Every component needs a date; more recent + more comps + tighter dispersion => higher confidence. Never claim a sale you did not find, and never emit a priced sold component without its retrieved url. Output ONLY JSON.',
        prompt: `Card: ${label}.

Return a WEIGHTED-CONSENSUS current value for THIS exact card (match grade if specified). Weight stronger data (many recent eBay sold comps) heaviest and cascade down to analogs only when needed. Return ONLY this JSON (USD, no prose, no code fences):
{
  "medianUsd": <current value from the chosen route — trimmed median / anchor-adjusted / triangulated estimate; number>,
  "lowUsd": <low end of the range, number or null>,
  "highUsd": <high end of the range, number or null>,
  "sampleSize": <total exact-match SOLD comps you saw (0 if none), integer>,
  "confidence": "high" | "medium" | "low",
  "estimated": <true if analogs carry the value, false if real exact-match comps do>,
  "method": "recent-median" | "anchor-and-adjust" | "triangulation",
  "anchorComp": { "priceUsd": <number>, "date": "<YYYY-MM-DD>", "kind": "sold"|"listing"|"guide"|"analog"|"index", "url": "<retrieved url>" } | null,
  "indexMovePct": <number or null>,
  "basis": "<one short line, e.g. 'trimmed median of 6 recent eBay PSA 10 solds' or 'anchor $17,100 (Feb 26) x -6.3% Mahomes index'>",
  "components": [
    { "source": "<e.g. eBay sold / PSA sales history / 130point / TCGplayer / PSA 9 comps (analog)>", "priceUsd": <number>, "date": "<YYYY-MM-DD or null>", "sampleSize": <int or null>, "weightPct": <0-100>, "kind": "sold"|"listing"|"guide"|"analog"|"index", "url": "<retrieved url — required for any 'sold'>", "note": "<optional short note>" }
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
        const kinds = ['sold', 'auction', 'listing', 'guide', 'index', 'analog'];
        const kind = (
          typeof o.kind === 'string' && kinds.includes(o.kind) ? o.kind : 'listing'
        ) as PriceComponent['kind'];
        const url = typeof o.url === 'string' ? o.url : null;
        // Anti-phantom: a real SOLD comp must carry a retrieved URL.
        if ((kind === 'sold' || kind === 'auction') && !url) return null;
        return {
          source,
          priceUsd: price,
          sampleSize: this.int(o.sampleSize),
          weightPct: this.num(o.weightPct),
          date: typeof o.date === 'string' ? o.date.slice(0, 10) : null,
          kind,
          url,
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
