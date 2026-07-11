import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiService } from '../integrations/ai/ai.service';
import { BUYER_VOLUME_HIGH_USD } from './buyer-volume.util';

const PAID_STATUSES_SQL =
  "('paid','shipped','delivered','payment_processing')";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** Per-card market row (dealer intelligence). */
export interface MarketCardRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  grade: string | null;
  /** Our listed price. */
  price: number | null;
  stock: number;
  isActive: boolean;
  sales: number;
  buyers: number;
  revenueUsd: number;
  lastSaleAt: string | null;
  /** Share of demand held by the single biggest buyer (%). */
  concentrationPct: number | null;
  liquidity: 'High' | 'Medium' | 'Low' | null;
  liquidityScore: number;
  /** eBay sold-comp derived range. low=p25, high=p75. */
  comps: {
    count: number;
    low: number | null;
    median: number | null;
    high: number | null;
    min: number | null;
    max: number | null;
  } | null;
  /** How wide the market is: (max-min)/median (%). */
  priceGapPct: number | null;
  /** Our price vs market median (%). Positive = we're above market. */
  vsMarketPct: number | null;
  /** A high-lifetime buyer bought this in the last 30 days. */
  whaleRecent: boolean;
}

interface RawRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  grade: string | null;
  price: number | string | null;
  stock: number;
  is_active: boolean;
  sales: number | string;
  buyers: number | string;
  revenue: number | string;
  last_sale: string | null;
  total_units: number | string | null;
  top_units: number | string | null;
  comp_count: number | string | null;
  p25: number | string | null;
  median: number | string | null;
  p75: number | string | null;
  min_price: number | string | null;
  max_price: number | string | null;
  whale_recent: boolean;
}

@Injectable()
export class MarketService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
  ) {}

  private async rawQuery<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const rows: unknown = await this.dataSource.query(sql, params);
    return (rows ?? []) as T[];
  }

  private cardRowsSql(extraWhere: string): string {
    return `
      WITH paid AS (
        SELECT prize_configuration_id AS cid, user_id, total_price, "createdAt"
        FROM prize_orders WHERE status IN ${PAID_STATUSES_SQL}
      ),
      agg AS (
        SELECT cid, COUNT(*) AS sales, COUNT(DISTINCT user_id) AS buyers,
               SUM(total_price)::float AS revenue, MAX("createdAt") AS last_sale
        FROM paid GROUP BY cid
      ),
      bc AS (
        SELECT cid, user_id, COUNT(*) AS units FROM paid GROUP BY cid, user_id
      ),
      conc AS (
        SELECT cid, SUM(units) AS total_units, MAX(units) AS top_units
        FROM bc GROUP BY cid
      ),
      comps AS (
        SELECT item_id AS cid, COUNT(*) AS comp_count,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY sale_price)::float AS p25,
          percentile_cont(0.5)  WITHIN GROUP (ORDER BY sale_price)::float AS median,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY sale_price)::float AS p75,
          MIN(sale_price)::float AS min_price, MAX(sale_price)::float AS max_price
        FROM prize_item_ebay_sold_listings
        WHERE is_inaccurate IS NOT TRUE
        GROUP BY item_id
      ),
      lifetime AS (
        SELECT user_id, SUM(total_price) AS lt FROM paid GROUP BY user_id
      ),
      whales AS (
        SELECT DISTINCT p.cid FROM paid p
        JOIN lifetime l ON l.user_id = p.user_id
        WHERE p."createdAt" >= now() - interval '30 days'
          AND l.lt >= ${BUYER_VOLUME_HIGH_USD}
      )
      SELECT c.id, c.name, c.brand, c.category, c.grade, c.price::float AS price,
             c.stock, c.is_active,
             COALESCE(a.sales,0) AS sales, COALESCE(a.buyers,0) AS buyers,
             COALESCE(a.revenue,0) AS revenue, a.last_sale,
             conc.total_units, conc.top_units,
             comps.comp_count, comps.p25, comps.median, comps.p75,
             comps.min_price, comps.max_price,
             (w.cid IS NOT NULL) AS whale_recent
      FROM prize_configurations c
      LEFT JOIN agg a ON a.cid = c.id
      LEFT JOIN conc ON conc.cid = c.id
      LEFT JOIN comps ON comps.cid = c.id
      LEFT JOIN whales w ON w.cid = c.id
      WHERE ${extraWhere}
    `;
  }

  private mapRow(r: RawRow): MarketCardRow {
    const sales = num(r.sales) ?? 0;
    const buyers = num(r.buyers) ?? 0;
    const totalUnits = num(r.total_units) ?? 0;
    const topUnits = num(r.top_units) ?? 0;
    const median = num(r.median);
    const min = num(r.min_price);
    const max = num(r.max_price);
    const price = num(r.price);
    const compCount = num(r.comp_count) ?? 0;

    const liquidityScore =
      sales > 0
        ? clamp(
            Math.round(
              (Math.min(sales, 20) / 20) * 60 +
                (Math.min(buyers, 10) / 10) * 40,
            ),
            0,
            100,
          )
        : 0;
    const liquidity =
      liquidityScore >= 66
        ? 'High'
        : liquidityScore >= 33
          ? 'Medium'
          : liquidityScore > 0
            ? 'Low'
            : null;

    return {
      id: r.id,
      name: r.name,
      brand: r.brand,
      category: r.category,
      grade: r.grade,
      price,
      stock: num(r.stock) ?? 0,
      isActive: r.is_active,
      sales,
      buyers,
      revenueUsd: num(r.revenue) ?? 0,
      lastSaleAt: r.last_sale,
      concentrationPct:
        totalUnits > 0 ? Math.round((topUnits / totalUnits) * 100) : null,
      liquidity,
      liquidityScore,
      comps:
        compCount > 0
          ? {
              count: compCount,
              low: num(r.p25),
              median,
              high: num(r.p75),
              min,
              max,
            }
          : null,
      priceGapPct:
        median && median > 0 && min != null && max != null
          ? Math.round(((max - min) / median) * 100)
          : null,
      vsMarketPct:
        price != null && median && median > 0
          ? Math.round(((price - median) / median) * 100)
          : null,
      whaleRecent: r.whale_recent,
    };
  }

  /** Paginated per-card market table with filters + sort. */
  async listCards(opts: {
    search?: string;
    brand?: string;
    category?: string;
    sort?: 'sales' | 'revenue' | 'gap' | 'concentration' | 'recent';
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; data: MarketCardRow[] }> {
    const params: unknown[] = [];
    const where: string[] = ['c.is_active = true'];
    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where.push(`c.name ILIKE $${params.length}`);
    }
    if (opts.brand && opts.brand !== 'all') {
      params.push(opts.brand);
      where.push(`c.brand = $${params.length}`);
    }
    if (opts.category && opts.category !== 'all') {
      params.push(opts.category);
      where.push(`c.category = $${params.length}`);
    }
    const whereSql = where.join(' AND ');

    const totalRows = await this.rawQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM prize_configurations c WHERE ${whereSql}`,
      params,
    );
    const total = num(totalRows[0]?.count) ?? 0;

    const orderExpr =
      opts.sort === 'revenue'
        ? 'revenue DESC NULLS LAST'
        : opts.sort === 'gap'
          ? '((comps.max_price - comps.min_price) / NULLIF(comps.median,0)) DESC NULLS LAST'
          : opts.sort === 'concentration'
            ? '(conc.top_units::float / NULLIF(conc.total_units,0)) DESC NULLS LAST'
            : opts.sort === 'recent'
              ? 'a.last_sale DESC NULLS LAST'
              : 'sales DESC NULLS LAST';

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(Math.min(opts.limit ?? 50, 200), opts.offset ?? 0);

    const rows = await this.rawQuery<RawRow>(
      `${this.cardRowsSql(whereSql)} ORDER BY ${orderExpr}, c."createdAt" DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return { total, data: rows.map((r) => this.mapRow(r)) };
  }

  /** Card row + top buyers + comps + time-to-sale (no AI). Reused by forecast. */
  async getCardSignals(id: string): Promise<{
    card: MarketCardRow;
    topBuyers: {
      userId: string;
      name: string | null;
      username: string;
      units: number;
      sharePct: number;
    }[];
    recentComps: {
      title: string;
      price: number | null;
      soldAt: string | null;
      url: string | null;
    }[];
    timeToSaleDays: number | null;
  }> {
    const rows = await this.rawQuery<RawRow>(
      `${this.cardRowsSql('c.id = $1')}`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Card not found');
    const card = this.mapRow(rows[0]);

    const buyerRows = await this.rawQuery<{
      user_id: string;
      name: string | null;
      username: string | null;
      units: string;
    }>(
      `SELECT o.user_id, u.name, u.username, COUNT(*)::int AS units
       FROM prize_orders o JOIN users u ON u.id = o.user_id
       WHERE o.prize_configuration_id = $1 AND o.status IN ${PAID_STATUSES_SQL}
       GROUP BY o.user_id, u.name, u.username
       ORDER BY units DESC LIMIT 6`,
      [id],
    );
    const totalUnits = card.sales || 1;
    const topBuyers = buyerRows.map((b) => ({
      userId: b.user_id,
      name: b.name,
      username: b.username ?? '',
      units: num(b.units) ?? 0,
      sharePct: Math.round(((num(b.units) ?? 0) / totalUnits) * 100),
    }));

    const compRows = await this.rawQuery<{
      sold_title: string;
      sale_price: string;
      date_sold: string | null;
      listing_url: string | null;
    }>(
      `SELECT sold_title, sale_price, date_sold, listing_url
       FROM prize_item_ebay_sold_listings
       WHERE item_id = $1 AND is_inaccurate IS NOT TRUE
       ORDER BY date_sold DESC NULLS LAST LIMIT 15`,
      [id],
    );
    const recentComps = compRows.map((c) => ({
      title: c.sold_title,
      price: num(c.sale_price),
      soldAt: c.date_sold,
      url: c.listing_url,
    }));

    const ttsRows = await this.rawQuery<{ days: string | null }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (o."createdAt" - c."createdAt")) / 86400
              ) AS days
       FROM prize_orders o JOIN prize_configurations c ON c.id = o.prize_configuration_id
       WHERE o.prize_configuration_id = $1 AND o.status IN ${PAID_STATUSES_SQL}
         AND o."createdAt" >= c."createdAt"`,
      [id],
    );
    const timeToSaleDays =
      num(ttsRows[0]?.days) != null ? Math.round(num(ttsRows[0]!.days)!) : null;

    return { card, topBuyers, recentComps, timeToSaleDays };
  }

  /** One card with full breakdown + AI hold/sell recommendation. */
  async getCardDetail(id: string): Promise<
    MarketCardRow & {
      topBuyers: {
        userId: string;
        name: string | null;
        username: string;
        units: number;
        sharePct: number;
      }[];
      recentComps: {
        title: string;
        price: number | null;
        soldAt: string | null;
        url: string | null;
      }[];
      timeToSaleDays: number | null;
      recommendation: { verdict: string; reasoning: string } | null;
    }
  > {
    const s = await this.getCardSignals(id);
    const recommendation = await this.holdVsSell(s.card, s.timeToSaleDays);
    return {
      ...s.card,
      topBuyers: s.topBuyers,
      recentComps: s.recentComps,
      timeToSaleDays: s.timeToSaleDays,
      recommendation,
    };
  }

  /** Claude-synthesized Hold vs Sell call over the computed signals. */
  private async holdVsSell(
    card: MarketCardRow,
    ttsDays: number | null,
  ): Promise<{ verdict: string; reasoning: string } | null> {
    if (!this.ai.isConfigured()) return null;
    try {
      const facts = {
        card: card.name,
        ourPrice: card.price,
        marketMedian: card.comps?.median ?? null,
        vsMarketPct: card.vsMarketPct,
        marketRange:
          card.comps?.min != null && card.comps?.max != null
            ? [card.comps.min, card.comps.max]
            : null,
        priceGapPct: card.priceGapPct,
        salesLifetime: card.sales,
        distinctBuyers: card.buyers,
        buyerConcentrationPct: card.concentrationPct,
        liquidity: card.liquidity,
        stockOnHand: card.stock,
        medianDaysToSale: ttsDays,
        whaleBoughtRecently: card.whaleRecent,
      };
      return await this.ai.generateJson<{
        verdict: string;
        reasoning: string;
      }>({
        system:
          'You are a trading-card dealer advisor. Given demand + market signals for one card, give a concise HOLD or SELL NOW call. Be pragmatic and specific; 1-2 sentences of reasoning.',
        prompt: `Signals:\n${JSON.stringify(
          facts,
          null,
          2,
        )}\n\nReturn JSON: {"verdict": "Hold" | "Sell now" | "Sell soon", "reasoning": "<1-2 sentences>"}`,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            verdict: { type: 'string', enum: ['Hold', 'Sell now', 'Sell soon'] },
            reasoning: { type: 'string' },
          },
          required: ['verdict', 'reasoning'],
        },
        maxTokens: 400,
      });
    } catch {
      return null;
    }
  }
}
