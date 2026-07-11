/** Minimal card identity a market source needs to look up pricing. */
export interface CardRef {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  grade: string | null;
}

/** One source's current read on a card's market (USD). */
export interface CardMarketReading {
  medianUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  avgUsd: number | null;
  /** Comps/data points behind the reading, when known. */
  sampleCount: number | null;
  currency?: string;
  /** Source-specific extras: cited sources, notes, per-grade pop, etc. */
  meta?: Record<string, unknown>;
}

/**
 * A pluggable market-data source for a card. Live sources (eBay, web research)
 * return a reading; dormant ones (awaiting API keys/impl) report
 * `isConfigured() === false` and are skipped. Adding a new source is just a new
 * class registered in CardProfileService.
 */
export interface CardMarketSource {
  /** Stable key stored on snapshots: 'ebay' | 'web' | 'tcgplayer' | … */
  readonly key: string;
  readonly label: string;
  isConfigured(): boolean;
  fetch(card: CardRef): Promise<CardMarketReading | null>;
}
