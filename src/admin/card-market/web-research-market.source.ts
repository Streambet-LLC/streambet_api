import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../integrations/ai/ai.service';
import { CardMarketReading, CardMarketSource, CardRef } from './card-market.types';

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
          'You are a trading-card pricing researcher. Find the CURRENT market value of ONE specific card and ALWAYS return a numeric estimate — never null, never "insufficient data". ' +
          'STEP 1 — DIRECT COMPS: Search for recent actual SOLD prices for the EXACT card + grade across as many sources as you can (eBay sold/completed, TCGplayer, PriceCharting, 130point, reputable guides). Weight recent SOLD prices most heavily. If you find solid exact-match comps, use them: set estimated=false and confidence high/medium. ' +
          'STEP 2 — TRIANGULATE (when the exact card has FEW or NO sold comps — ultra-rare, brand-new, or illiquid): do NOT give up. Build a best-estimate range from the closest available signals, in rough priority: (a) the SAME card in adjacent grades (e.g. a PSA 10 from PSA 9/9.5 sales via the typical grade multiplier); (b) the raw↔graded multiplier for this card; (c) sibling cards in the SAME set/product (other alt-arts, parallels, chase cards of similar tier); (d) the SAME character/player in comparable prints/years; (e) print-run or PSA/BGS population scarcity as a scaling factor; (f) current ASKING prices / Buy-It-Now / active listings when no sale exists. Set estimated=true and confidence="low". ' +
          'Always state in `basis` exactly what you used (which comps or which analogs and the adjustment). Never claim a specific sale happened that you did not find. Output ONLY JSON.',
        prompt: `Card: ${label}.

Return the current value for THIS exact card (match grade if specified). ALWAYS provide a numeric range — if exact comps are thin/absent, TRIANGULATE from comparable cards and mark it estimated. Return ONLY this JSON (USD, no prose, no code fences):
{
  "medianUsd": <best single current value, number — required, never null>,
  "lowUsd": <low end, number or null>,
  "highUsd": <high end, number or null>,
  "sampleSize": <rough count of exact-match comps you saw (0 if none), integer>,
  "confidence": "high" | "medium" | "low",
  "estimated": <true if triangulated from comparable cards, false if from real exact-match sold comps>,
  "basis": "<one short line: which comps or analogs and any adjustment, e.g. 'no PSA 10 sold; est. from 2 PSA 9 sales x ~1.8 10/9 multiplier'>",
  "asOf": "<YYYY-MM-DD of the freshest data you used, or null>",
  "note": "<one short sentence on the read, or null>",
  "sources": [ { "title": "<site/source>", "url": "<url>" } ]
}`,
        maxTokens: 8000,
        meta: { feature: 'card_profile' },
      });

      const low = this.num(res.lowUsd);
      const high = this.num(res.highUsd);
      // Never drop a read for lack of data — fall back to the low/high midpoint
      // so a triangulated estimate still surfaces a number.
      const median =
        this.num(res.medianUsd) ??
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
}
