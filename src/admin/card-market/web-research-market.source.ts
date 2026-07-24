import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../integrations/ai/ai.service';
import { CardMarketReading, CardMarketSource, CardRef } from './card-market.types';

interface WebPriceResult {
  medianUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  sampleSize: number | null;
  confidence: 'high' | 'medium' | 'low' | string;
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
          'You are a trading-card pricing researcher. Use web search to find the CURRENT market price for one specific card by checking recent sold data across as many sources as you can — eBay sold/completed listings, TCGplayer, PriceCharting, 130point, and any reputable price guides. Weight recent actual SOLD prices most heavily. Match the exact card, set/product, and grade if given. Output ONLY JSON.',
        prompt: `Card: ${label}.

Find the current going price for THIS exact card (match grade if specified). Return ONLY this JSON (USD, no prose, no code fences):
{
  "medianUsd": <typical current price, number or null>,
  "lowUsd": <low end of recent sales, number or null>,
  "highUsd": <high end of recent sales, number or null>,
  "sampleSize": <rough count of comps you saw, integer or null>,
  "confidence": "high" | "medium" | "low",
  "asOf": "<YYYY-MM-DD of the freshest data you used, or null>",
  "note": "<one short sentence on the read, or null>",
  "sources": [ { "title": "<site/source>", "url": "<url>" } ]
}`,
        maxTokens: 8000,
        meta: { feature: 'card_profile' },
      });

      const median = this.num(res.medianUsd);
      const low = this.num(res.lowUsd);
      const high = this.num(res.highUsd);
      if (median == null && low == null && high == null) return null;
      return {
        medianUsd: median,
        lowUsd: low,
        highUsd: high,
        avgUsd: median,
        sampleCount: this.int(res.sampleSize),
        currency: 'USD',
        meta: {
          confidence: res.confidence ?? null,
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
