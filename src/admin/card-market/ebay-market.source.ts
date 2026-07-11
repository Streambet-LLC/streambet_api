import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CardMarketReading, CardMarketSource, CardRef } from './card-market.types';

/**
 * eBay sold-comps source. Reads the `prize_item_ebay_sold_listings` table that
 * the existing eBay sync populates (official eBay API — see
 * EbaySoldMarketSyncService), aggregating valid comps into a current reading.
 *
 * Always "configured" — reading whatever comps exist is free — but returns null
 * when there are no comps for the card (e.g. eBay sync hasn't run / no creds).
 */
@Injectable()
export class EbayMarketSource implements CardMarketSource {
  readonly key = 'ebay';
  readonly label = 'eBay sold comps';

  constructor(private readonly dataSource: DataSource) {}

  isConfigured(): boolean {
    return true;
  }

  async fetch(card: CardRef): Promise<CardMarketReading | null> {
    const rows = (await this.dataSource.query(
      `SELECT
         COUNT(*)::int AS n,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY sale_price)::float AS median,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY sale_price)::float AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY sale_price)::float AS p75,
         MIN(sale_price)::float AS min_p,
         MAX(sale_price)::float AS max_p,
         AVG(sale_price)::float AS avg_p
       FROM prize_item_ebay_sold_listings
       WHERE item_id = $1 AND is_inaccurate IS NOT TRUE`,
      [card.id],
    )) as {
      n: number;
      median: number | null;
      p25: number | null;
      p75: number | null;
      min_p: number | null;
      max_p: number | null;
      avg_p: number | null;
    }[];

    const r = rows[0];
    if (!r || !r.n) return null;
    return {
      medianUsd: r.median,
      lowUsd: r.p25,
      highUsd: r.p75,
      avgUsd: r.avg_p,
      sampleCount: r.n,
      currency: 'USD',
      meta: { minUsd: r.min_p, maxUsd: r.max_p },
    };
  }
}
