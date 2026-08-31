import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { MarketTaxonomyService } from './market-taxonomy.service';

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

export interface EngagementResult {
  segment: string;
  label: string | null;
  scope: string;
  itemCount: number;
  totalViews: number;
  totalWatchers: number;
  newViews7d: number;
  newWatchers7d: number;
}

interface ShopItem {
  id: string;
  name: string;
  brand: string | null;
  view_count: number | null;
  watcher_count: number | null;
}

/**
 * First-party engagement engine — a daily roll-up of OUR platform's item views
 * and saves (watchers) onto taxonomy nodes (market → sub-category → set →
 * player/card), stored as a time series so peaks and troughs are visible. This
 * is the reliable, free signal we uniquely own; it complements the external
 * eBay heat. Attention is attributed by classifying each shop item's name/brand
 * against the taxonomy, so it drills down by every dimension.
 */
@Injectable()
export class MarketEngagementService {
  private readonly logger = new Logger(MarketEngagementService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly taxonomy: MarketTaxonomyService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async collectDaily(): Promise<void> {
    try {
      const r = await this.collectAll();
      this.logger.log(`Market-engagement: snapshotted ${r.length} node(s).`);
    } catch (e) {
      this.logger.warn(`Market-engagement snapshot failed: ${(e as Error).message}`);
    }
  }

  async collectAll(): Promise<EngagementResult[]> {
    const nodes = await this.taxonomy.list();
    if (!nodes.length) return [];

    const items: ShopItem[] = await this.ds.query(
      `SELECT id, name, brand, view_count, watcher_count
         FROM prize_configurations
        WHERE is_active = true`,
    );
    if (!items.length) return [];

    // Trailing-7d event counts per item (attention velocity).
    const views7d: { item_id: string; c: number }[] = await this.ds.query(
      `SELECT item_id, COUNT(*)::int AS c FROM prize_item_views
         WHERE viewed_on > (CURRENT_DATE - 7) GROUP BY item_id`,
    );
    const watch7d: { item_id: string; c: number }[] = await this.ds.query(
      `SELECT item_id, COUNT(*)::int AS c FROM prize_item_watchers
         WHERE created_at > now() - interval '7 days' GROUP BY item_id`,
    );
    const viewsMap = new Map(views7d.map(r => [r.item_id, r.c]));
    const watchMap = new Map(watch7d.map(r => [r.item_id, r.c]));

    type Agg = {
      itemCount: number;
      totalViews: number;
      totalWatchers: number;
      newViews7d: number;
      newWatchers7d: number;
    };
    const agg = new Map<string, Agg>();
    const bump = (key: string | null, it: ShopItem) => {
      if (!key) return;
      const a =
        agg.get(key) ??
        { itemCount: 0, totalViews: 0, totalWatchers: 0, newViews7d: 0, newWatchers7d: 0 };
      a.itemCount += 1;
      a.totalViews += it.view_count ?? 0;
      a.totalWatchers += it.watcher_count ?? 0;
      a.newViews7d += viewsMap.get(it.id) ?? 0;
      a.newWatchers7d += watchMap.get(it.id) ?? 0;
      agg.set(key, a);
    };

    for (const it of items) {
      const t = this.taxonomy.classifyWith(nodes, it.name, it.brand);
      // Attribute to each dimension the item resolves to (one market, so market
      // totals don't double-count; set/player are subsets of that market).
      bump(t.marketKey, it);
      bump(t.subCategoryKey, it);
      bump(t.setKey, it);
      bump(t.playerKey, it);
      bump(t.cardKey, it);
    }

    const nodeByKey = new Map(nodes.map(n => [n.key, n]));
    const runAt = new Date();
    const out: EngagementResult[] = [];

    for (const [key, a] of agg) {
      const node = nodeByKey.get(key);
      const scope =
        node?.heatScope ??
        (node?.kind === 'market' ? 'segment' : node?.kind ?? 'segment');
      const prev = await this.ds.query(
        `SELECT "totalViews", "totalWatchers" FROM market_engagement_points
           WHERE segment = $1 ORDER BY "capturedAt" DESC LIMIT 1`,
        [key],
      );
      const pv = num(prev[0]?.totalViews);
      const pw = num(prev[0]?.totalWatchers);
      const viewsChangePct = pv && a.totalViews ? ((a.totalViews - pv) / pv) * 100 : null;
      const watchersChangePct =
        pw && a.totalWatchers ? ((a.totalWatchers - pw) / pw) * 100 : null;

      await this.ds.query(
        `INSERT INTO market_engagement_points
           (segment, scope, label, "capturedAt", "itemCount", "totalViews",
            "totalWatchers", "newViews7d", "newWatchers7d", "viewsChangePct",
            "watchersChangePct")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          key,
          scope,
          node?.label ?? key,
          runAt,
          a.itemCount,
          a.totalViews,
          a.totalWatchers,
          a.newViews7d,
          a.newWatchers7d,
          viewsChangePct,
          watchersChangePct,
        ],
      );

      out.push({
        segment: key,
        label: node?.label ?? key,
        scope,
        itemCount: a.itemCount,
        totalViews: a.totalViews,
        totalWatchers: a.totalWatchers,
        newViews7d: a.newViews7d,
        newWatchers7d: a.newWatchers7d,
      });
    }
    return out;
  }

  /** Latest engagement point per node, enriched with taxonomy context. */
  latest(scope?: string, market?: string): Promise<unknown[]> {
    const conds: string[] = [];
    const params: string[] = [];
    if (scope && scope !== 'all') {
      params.push(scope);
      conds.push(`e.scope = $${params.length}`);
    }
    if (market && market !== 'all') {
      params.push(market);
      conds.push(`t."rootMarket" = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return this.ds.query(
      `SELECT DISTINCT ON (e.segment) e.*,
              t."rootMarket", t.kind AS "taxKind", t."parentKey"
         FROM market_engagement_points e
         LEFT JOIN market_taxonomy t ON t.key = e.segment
         ${where}
         ORDER BY e.segment, e."capturedAt" DESC`,
      params,
    );
  }

  /** Time series for one node. */
  series(segment: string, sinceDays = 60): Promise<unknown[]> {
    const days = Math.max(1, Math.min(Number.isFinite(sinceDays) ? sinceDays : 60, 365));
    return this.ds.query(
      `SELECT * FROM market_engagement_points
         WHERE segment = $1 AND "capturedAt" >= now() - ($2 || ' days')::interval
         ORDER BY "capturedAt" ASC`,
      [segment, String(days)],
    );
  }
}
