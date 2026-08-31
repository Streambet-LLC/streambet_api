import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { EbayBrowseSource } from './card-market/ebay-browse.source';
import { AcquisitionService } from './acquisition/acquisition.service';

export interface HeatTopic {
  key: string;
  scope: 'segment' | 'set' | 'card' | 'player';
  label: string;
  /** eBay search that samples this market's active listings. */
  query: string;
  /** Keywords to attribute first-party tracked cards (empty = match all). */
  match: string[];
}

/**
 * Fallback topic list, used only when the `market_taxonomy` table is empty or
 * unavailable. The live topics are driven by the taxonomy (see loadHeatTopics)
 * so adding a set / card / player node there gets it snapshotted automatically.
 */
export const HEAT_TOPICS: HeatTopic[] = [
  { key: 'pokemon', scope: 'segment', label: 'Pokémon', query: 'pokemon card', match: ['pokemon', 'pokémon'] },
  { key: 'one_piece', scope: 'segment', label: 'One Piece', query: 'one piece card', match: ['one piece'] },
  { key: 'sports', scope: 'segment', label: 'Sports', query: 'sports card', match: ['sport', 'basketball', 'football', 'baseball', 'nba', 'nfl', 'mlb', 'panini', 'topps'] },
  { key: 'magic', scope: 'segment', label: 'Magic', query: 'magic the gathering card', match: ['magic', 'mtg', 'gathering'] },
  { key: 'lorcana', scope: 'segment', label: 'Lorcana', query: 'disney lorcana card', match: ['lorcana'] },
  { key: 'all', scope: 'segment', label: 'All TCG', query: 'trading card game', match: [] },
  // Hot sets
  { key: 'set_pkm_151', scope: 'set', label: 'Pokémon 151', query: 'pokemon 151 card', match: ['151'] },
  { key: 'set_pkm_surging', scope: 'set', label: 'Surging Sparks', query: 'pokemon surging sparks', match: ['surging sparks'] },
  { key: 'set_pkm_prismatic', scope: 'set', label: 'Prismatic Evolutions', query: 'pokemon prismatic evolutions', match: ['prismatic'] },
  { key: 'set_op_09', scope: 'set', label: 'One Piece OP-09', query: 'one piece OP-09', match: ['op-09', 'op09'] },
  // Marquee cards
  { key: 'card_moonbreon', scope: 'card', label: 'Umbreon VMAX Alt Art', query: 'umbreon vmax alt art 215', match: ['umbreon'] },
  { key: 'card_charizard_base', scope: 'card', label: 'Base Set Charizard', query: 'charizard base set holo', match: ['charizard'] },
  { key: 'card_jordan_fleer', scope: 'card', label: 'Jordan Fleer RC', query: 'michael jordan 1986 fleer rookie', match: ['jordan'] },
  { key: 'card_lebron_prizm', scope: 'card', label: 'LeBron Prizm', query: 'lebron james prizm', match: ['lebron'] },
];

/**
 * Load the live snapshot topics from the taxonomy — every active node that
 * carries an eBay query and a heat scope (markets, sets, players, marquee
 * cards). Adding a node there is all it takes to start tracking a new market.
 * Falls back to the hardcoded HEAT_TOPICS if the table is empty/absent.
 */
export async function loadHeatTopics(ds: DataSource): Promise<HeatTopic[]> {
  try {
    const rows = await ds.query(
      `SELECT key, "heatScope", label, query, "matchTerms"
         FROM market_taxonomy
        WHERE active = true AND query IS NOT NULL AND "heatScope" IS NOT NULL
        ORDER BY "heatScope", "sortOrder", label`,
    );
    if (rows && rows.length) {
      return rows.map((r: {
        key: string;
        heatScope: HeatTopic['scope'];
        label: string;
        query: string;
        matchTerms: string[] | null;
      }) => ({
        key: r.key,
        scope: r.heatScope,
        label: r.label,
        query: r.query,
        match: Array.isArray(r.matchTerms) ? r.matchTerms : [],
      }));
    }
  } catch {
    /* taxonomy table may not exist yet — fall back to the constant */
  }
  return HEAT_TOPICS;
}

/** A social buzz probe (non-persisting) — supplied by the Nest layer. */
export type SocialBuzzFn = (
  query: string,
) => Promise<{ mentions: number | null; bySource: Record<string, number> }>;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Least-squares linear fit; null if <2 points or degenerate. */
function fitLine(
  points: { x: number; y: number }[],
): { slope: number; intercept: number; r2: number; n: number } | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    const pred = slope * p.x + intercept;
    ssRes += (p.y - pred) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;
  return { slope, intercept, r2, n };
}

/**
 * Composite 0-100 heat from the leading indicators. Each component degrades
 * gracefully — day 1 (no prior snapshot) leans on aging alone; velocity and
 * price/supply momentum kick in once history exists. Weights are tunable.
 */
export function computeHeat(x: {
  clearedRatePct: number | null;
  askChangePct: number | null;
  agingPct: number | null;
  totalActiveChangePct: number | null;
  socialMentions?: number | null;
  firstPartyAdds?: number | null;
}): number | null {
  // Weights favour the robust aggregate signals (price + supply momentum) over
  // the page-level sample velocity/aging, which is noisier (Best-Match churn).
  const comps: { v: number; w: number }[] = [];
  if (x.askChangePct != null)
    comps.push({ v: clamp(50 + x.askChangePct * 2.5, 0, 100), w: 0.3 }); // price momentum (robust)
  if (x.totalActiveChangePct != null)
    comps.push({ v: clamp(50 - x.totalActiveChangePct * 2, 0, 100), w: 0.3 }); // supply momentum (robust)
  if (x.clearedRatePct != null)
    comps.push({ v: clamp((x.clearedRatePct / 40) * 100, 0, 100), w: 0.15 }); // sell-through (noisy)
  if (x.agingPct != null)
    comps.push({ v: clamp(100 - x.agingPct, 0, 100), w: 0.1 }); // less sitting (noisy)
  if (x.socialMentions != null)
    comps.push({ v: clamp((x.socialMentions / 50) * 100, 0, 100), w: 0.15 }); // social buzz
  if (x.firstPartyAdds != null && x.firstPartyAdds > 0)
    comps.push({ v: clamp((x.firstPartyAdds / 5) * 100, 0, 100), w: 0.1 }); // our saves/follows
  // Cold-start guard: a score needs a real ANCHOR — day-over-day momentum
  // (supply/price/sell-through) or social buzz. Aging / first-party alone are
  // too weak and, on a first snapshot, spuriously read as hot (fresh listings
  // look un-aged → 100). Without an anchor we return null ("—") until history
  // accrues on the next daily snapshot.
  const hasMomentum =
    x.clearedRatePct != null || x.askChangePct != null || x.totalActiveChangePct != null;
  const hasSocial = x.socialMentions != null;
  if (comps.length === 0 || (!hasMomentum && !hasSocial)) return null;
  const wsum = comps.reduce((s, c) => s + c.w, 0);
  return Math.round(comps.reduce((s, c) => s + c.v * c.w, 0) / wsum);
}

export interface CollectResult {
  segment: string;
  label: string;
  totalActive: number | null;
  sampleActive: number;
  newCount: number;
  clearedCount: number;
  heatScore: number | null;
  medianAskUsd: number | null;
}

/**
 * Snapshot one segment's active eBay listings, update the listing-lifecycle
 * table, and store a computed heat point. Uses raw SQL so the exact same logic
 * runs from the NestJS cron and from a standalone seed script.
 */
export async function collectTopic(
  ds: DataSource,
  ebay: EbayBrowseSource,
  topic: HeatTopic,
  opts?: { social?: SocialBuzzFn },
): Promise<CollectResult | null> {
  const segment = topic.key;
  const query = topic.query;

  // Sample the top 200 (eBay's max) — a bigger sample steadies the median-ask
  // and days-on-market stats against Best-Match page churn.
  const res = await ebay.searchActive(query, 200);
  // Bail on an empty/failed fetch — never clear the whole segment on a miss.
  if (!res || res.items.length === 0) return null;

  const runAt = new Date();
  const { total, items } = res;
  const seenIds = items.map(i => i.externalId);

  const [{ n: prevActive }] = await ds.query(
    `SELECT COUNT(*)::int AS n FROM market_listings WHERE segment=$1 AND active=true`,
    [segment],
  );

  const prevPoint = await ds.query(
    `SELECT "medianAskUsd", "totalActive" FROM market_heat_points
       WHERE segment=$1 ORDER BY "capturedAt" DESC LIMIT 1`,
    [segment],
  );
  const prevMedianAsk = num(prevPoint[0]?.medianAskUsd);
  const prevTotalActive = num(prevPoint[0]?.totalActive);

  const existingRows = await ds.query(
    `SELECT "externalId" FROM market_listings
       WHERE segment=$1 AND source='ebay' AND "externalId" = ANY($2::text[])`,
    [segment, seenIds],
  );
  const existing = new Set<string>(existingRows.map((r: { externalId: string }) => r.externalId));
  const newCount = seenIds.filter(id => !existing.has(id)).length;

  // Upsert every listing we saw this run.
  for (const it of items) {
    await ds.query(
      `INSERT INTO market_listings
         (segment, source, "externalId", title, "priceUsd", currency, url,
          "firstSeenAt", "lastSeenAt", active, "clearedAt")
       VALUES ($1,'ebay',$2,$3,$4,$5,$6,$7,$7,true,NULL)
       ON CONFLICT (source, "externalId", segment) DO UPDATE SET
         "lastSeenAt" = EXCLUDED."lastSeenAt",
         "priceUsd"   = EXCLUDED."priceUsd",
         currency     = EXCLUDED.currency,
         title        = EXCLUDED.title,
         url          = EXCLUDED.url,
         active       = true,
         "clearedAt"  = NULL,
         "updatedAt"  = now()`,
      [segment, it.externalId, it.title, it.priceUsd, it.currency, it.url, runAt],
    );
  }

  // Anything active for this segment that wasn't in this run = sold/pulled.
  // Count with a SELECT first — a raw UPDATE's result shape isn't portable.
  const [{ n: clearedCount }] = await ds.query(
    `SELECT COUNT(*)::int AS n FROM market_listings
       WHERE segment=$1 AND active=true AND "externalId" <> ALL($2::text[])`,
    [segment, seenIds],
  );
  await ds.query(
    `UPDATE market_listings SET active=false, "clearedAt"=$2, "updatedAt"=now()
       WHERE segment=$1 AND active=true AND "externalId" <> ALL($3::text[])`,
    [segment, runAt, seenIds],
  );

  const [m] = await ds.query(
    `SELECT
       COUNT(*)::int AS sample_active,
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (now() - "firstSeenAt"))/86400.0) AS median_days,
       AVG(CASE WHEN EXTRACT(EPOCH FROM (now() - "firstSeenAt"))/86400.0 > 14
            THEN 1.0 ELSE 0.0 END) * 100 AS aging_pct,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY "priceUsd")
         FILTER (WHERE "priceUsd" IS NOT NULL AND "priceUsd" > 0) AS median_ask
     FROM market_listings WHERE segment=$1 AND active=true`,
    [segment],
  );
  const sampleActive = num(m?.sample_active) ?? 0;
  const medianDaysListed = num(m?.median_days);
  const agingPct = num(m?.aging_pct);
  const medianAskUsd = num(m?.median_ask);

  const clearedRatePct = prevActive > 0 ? (clearedCount / prevActive) * 100 : null;
  const askChangePct =
    prevMedianAsk && medianAskUsd
      ? ((medianAskUsd - prevMedianAsk) / prevMedianAsk) * 100
      : null;
  const totalActiveChangePct =
    prevTotalActive && total
      ? ((total - prevTotalActive) / prevTotalActive) * 100
      : null;

  // First-party engagement (our own "saves/follows") — recent tracked-card
  // adds attributed to this segment. Grows as the app is used.
  let firstParty: { recentAdds: number; recentWatches: number } | null = null;
  try {
    const kw = topic.match ?? [];
    const fp =
      kw.length === 0
        ? (await ds.query(
            `SELECT COUNT(*)::int AS adds,
                    COUNT(*) FILTER (WHERE owned=false)::int AS watches
               FROM tracked_cards WHERE "createdAt" > now() - interval '7 days'`,
          ))[0]
        : (await ds.query(
            `SELECT COUNT(*)::int AS adds,
                    COUNT(*) FILTER (WHERE owned=false)::int AS watches
               FROM tracked_cards WHERE "createdAt" > now() - interval '7 days'
                 AND (name ILIKE ANY($1) OR category ILIKE ANY($1) OR brand ILIKE ANY($1))`,
            [kw.map(k => `%${k}%`)],
          ))[0];
    firstParty = { recentAdds: fp?.adds ?? 0, recentWatches: fp?.watches ?? 0 };
  } catch {
    /* tracked_cards may be empty */
  }

  // Social buzz (optional; only when a source is configured on the server).
  let social: { mentions: number | null; bySource: Record<string, number> } | null = null;
  if (opts?.social) {
    try {
      social = await opts.social(query);
    } catch {
      /* skip social on failure */
    }
  }

  const heatScore = computeHeat({
    clearedRatePct,
    askChangePct,
    agingPct,
    totalActiveChangePct,
    socialMentions: social?.mentions ?? null,
    firstPartyAdds: firstParty?.recentAdds ?? null,
  });
  const extra = JSON.stringify({ social, firstParty });

  await ds.query(
    `INSERT INTO market_heat_points
       (segment, scope, label, "capturedAt", "totalActive", "totalActiveChangePct",
        "sampleActive", "newCount", "clearedCount", "clearedRatePct", "medianDaysListed",
        "agingPct", "medianAskUsd", "askChangePct", "heatScore", "sampleQuery", extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
    [
      segment, topic.scope, topic.label, runAt, total, totalActiveChangePct,
      sampleActive, newCount, clearedCount, clearedRatePct, medianDaysListed,
      agingPct, medianAskUsd, askChangePct, heatScore, query, extra,
    ],
  );

  return {
    segment,
    label: topic.label,
    totalActive: total,
    sampleActive,
    newCount,
    clearedCount,
    heatScore,
    medianAskUsd,
  };
}

/** Snapshot every topic (sequential — gentle on the eBay rate limit). */
export async function collectMarketHeat(
  ds: DataSource,
  ebay: EbayBrowseSource,
  opts?: { social?: SocialBuzzFn },
): Promise<CollectResult[]> {
  const topics = await loadHeatTopics(ds);
  const out: CollectResult[] = [];
  for (const topic of topics) {
    try {
      const r = await collectTopic(ds, ebay, topic, opts);
      if (r) out.push(r);
    } catch {
      /* one topic failing must not stop the rest */
    }
  }
  return out;
}

/**
 * Real-time market-heat engine — a daily snapshot of eBay ACTIVE listings per
 * segment, turned into leading indicators (sell-through velocity, days-on-
 * market, supply + price momentum) that move before lagging sold comps.
 */
@Injectable()
export class MarketHeatService {
  private readonly logger = new Logger(MarketHeatService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly ebay: EbayBrowseSource,
    private readonly acquisition: AcquisitionService,
  ) {}

  /** Enrichment probes handed to the core collector. */
  private get opts(): { social: SocialBuzzFn } {
    return { social: (q: string) => this.acquisition.buzzVolume(q) };
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async collectDaily(): Promise<void> {
    if (!this.ebay.isConfigured()) return;
    const started = Date.now();
    const r = await collectMarketHeat(this.ds, this.ebay, this.opts);
    this.logger.log(
      `Market-heat: snapshotted ${r.length} segment(s) in ${Date.now() - started}ms`,
    );
  }

  collectAll(): Promise<CollectResult[]> {
    return collectMarketHeat(this.ds, this.ebay, this.opts);
  }

  /**
   * Snapshot a SINGLE taxonomy topic now — used right after a user adds a new
   * player/card/set from the heat panel, so it shows data immediately instead
   * of waiting for the nightly cron.
   */
  async collectOne(key: string): Promise<CollectResult | null> {
    if (!this.ebay.isConfigured()) return null;
    const rows = await this.ds.query(
      `SELECT key, "heatScope", label, query, "matchTerms"
         FROM market_taxonomy
        WHERE key = $1 AND active = true AND query IS NOT NULL
        LIMIT 1`,
      [key],
    );
    const n = rows[0] as
      | { key: string; heatScope: HeatTopic['scope'] | null; label: string; query: string; matchTerms: string[] | null }
      | undefined;
    if (!n) return null;
    return collectTopic(
      this.ds,
      this.ebay,
      {
        key: n.key,
        scope: n.heatScope ?? 'segment',
        label: n.label,
        query: n.query,
        match: Array.isArray(n.matchTerms) ? n.matchTerms : [],
      },
      this.opts,
    );
  }

  /**
   * Purge a topic's stored snapshots (heat points, sampled listings, engagement
   * points) so a removed/untracked market leaves the board. The taxonomy node
   * itself is deleted separately via the taxonomy API.
   */
  async removeTopic(key: string): Promise<{ removed: string }> {
    await this.ds.query(`DELETE FROM market_heat_points WHERE segment = $1`, [key]);
    await this.ds.query(`DELETE FROM market_listings WHERE segment = $1`, [key]);
    await this.ds.query(`DELETE FROM market_engagement_points WHERE segment = $1`, [key]);
    return { removed: key };
  }

  /**
   * Preview what an eBay query returns (active total + a few sample listings)
   * so a market can be sanity-checked before it's saved as a tracked topic.
   */
  async preview(
    query: string,
  ): Promise<{ total: number; items: { title: string; priceUsd: number | null; url: string }[] }> {
    if (!query || !this.ebay.isConfigured()) return { total: 0, items: [] };
    const res = await this.ebay.searchActive(query, 10);
    if (!res) return { total: 0, items: [] };
    return {
      total: res.total,
      items: res.items.slice(0, 6).map(i => ({ title: i.title, priceUsd: i.priceUsd, url: i.url })),
    };
  }

  /**
   * Latest heat point per topic (for the "hottest markets" ranking), enriched
   * with its taxonomy context (rootMarket / kind / parentKey) so the UI can
   * roll up and drill down. Optional `scope` and `market` (rootMarket) filters.
   */
  latest(scope?: string, market?: string): Promise<unknown[]> {
    const conds: string[] = [];
    const params: string[] = [];
    if (scope && scope !== 'all') {
      params.push(scope);
      conds.push(`h.scope = $${params.length}`);
    }
    if (market && market !== 'all') {
      params.push(market);
      conds.push(`t."rootMarket" = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return this.ds.query(
      `SELECT DISTINCT ON (h.segment) h.*,
              t."rootMarket", t.kind AS "taxKind", t."parentKey"
         FROM market_heat_points h
         LEFT JOIN market_taxonomy t ON t.key = h.segment
         ${where}
         ORDER BY h.segment, h."capturedAt" DESC`,
      params,
    );
  }

  /**
   * Biggest heat movers — topics whose heat score changed most vs. their prior
   * snapshot. Needs ≥2 snapshots per topic (empty until the second daily run).
   */
  movers(scope?: string, limit = 12): Promise<unknown[]> {
    const filtered = scope && scope !== 'all';
    const lim = Math.max(1, Math.min(limit, 50));
    return this.ds.query(
      `WITH ranked AS (
         SELECT segment, label, scope, "heatScore", "totalActive",
                "totalActiveChangePct", "askChangePct", "clearedRatePct", "capturedAt",
                ROW_NUMBER() OVER (PARTITION BY segment ORDER BY "capturedAt" DESC) AS rn
         FROM market_heat_points
         ${filtered ? 'WHERE scope = $1' : ''}
       )
       SELECT cur.segment, cur.label, cur.scope, cur."heatScore" AS heat,
              (cur."heatScore" - prev."heatScore") AS "heatChange",
              cur."totalActive", cur."totalActiveChangePct", cur."askChangePct",
              cur."clearedRatePct", cur."capturedAt"
       FROM ranked cur
       JOIN ranked prev ON prev.segment = cur.segment AND prev.rn = 2
       WHERE cur.rn = 1 AND cur."heatScore" IS NOT NULL AND prev."heatScore" IS NOT NULL
       ORDER BY ABS(cur."heatScore" - prev."heatScore") DESC
       LIMIT ${lim}`,
      filtered ? [scope] : [],
    );
  }

  /**
   * A composed market digest — hottest/coolest markets, ask-momentum risers,
   * and NOTABLE heat moves (the "alerts": |Δheat| ≥ 10) — plus a one-line
   * templated headline. Data source for a daily push (email/in-app) or a UI
   * summary; the notable list is the alert feed.
   */
  async digest(scope = 'segment'): Promise<{
    asOf: string | null;
    scope: string;
    headline: string;
    hottest: Record<string, unknown>[];
    coolest: Record<string, unknown>[];
    movers: Record<string, unknown>[];
    notable: Record<string, unknown>[];
  }> {
    const [latest, movers] = await Promise.all([
      this.latest(scope),
      this.movers(scope, 20),
    ]);
    const pick = (r: Record<string, unknown>) => ({
      market: r.label || r.segment,
      scope: r.scope,
      heat: r.heatScore,
      totalActive: r.totalActive,
      askChangePct: r.askChangePct,
      supplyChangePct: r.totalActiveChangePct,
    });
    const rows = (latest as Record<string, unknown>[])
      .filter(r => r.heatScore != null)
      .sort((a, b) => (b.heatScore as number) - (a.heatScore as number));
    const hottest = rows.slice(0, 3).map(pick);
    const coolest = rows.slice(-3).reverse().map(pick);
    const mv = (movers as Record<string, unknown>[]).map(m => ({
      market: m.label || m.segment,
      heatChange: m.heatChange,
      askChangePct: m.askChangePct,
      notable: Math.abs((m.heatChange as number) ?? 0) >= 10,
    }));
    const notable = mv.filter(m => m.notable);

    const parts: string[] = [];
    if (hottest[0])
      parts.push(`${hottest[0].market} leads at ${hottest[0].heat} heat`);
    const risers = rows
      .filter(r => ((r.askChangePct as number) ?? 0) >= 3)
      .slice(0, 2)
      .map(r => `${r.label || r.segment} (+${(r.askChangePct as number).toFixed(0)}% asks)`);
    if (risers.length) parts.push(`asks climbing in ${risers.join(', ')}`);
    if (notable.length) parts.push(`${notable.length} notable heat move(s)`);
    const headline = parts.length
      ? parts.join('; ') + '.'
      : 'Markets quiet — no notable moves.';

    return {
      asOf: (rows[0]?.capturedAt as string) ?? null,
      scope,
      headline,
      hottest,
      coolest,
      movers: mv,
      notable,
    };
  }

  /**
   * Heat ↔ CRM bridge: for a given market/topic, find the audience to act on —
   * interested BUYERS + discovered LEADS to reach out to when it's hot, and
   * SELLERS to source from when supply is sitting. Matched by the topic's
   * keywords against contact interests/tags and lead interests/text.
   */
  async matchAudience(
    marketKey: string,
    limit = 20,
  ): Promise<{
    market: string;
    keywords: string[];
    buyers: unknown[];
    sellers: unknown[];
    leads: unknown[];
  }> {
    const node = (
      await this.ds.query(
        `SELECT label, "matchTerms" FROM market_taxonomy WHERE key = $1 LIMIT 1`,
        [marketKey],
      )
    )[0] as { label?: string; matchTerms?: string[] } | undefined;
    const fallback = HEAT_TOPICS.find(t => t.key === marketKey);
    const label = node?.label || fallback?.label || marketKey;
    const rawKw =
      node?.matchTerms?.length
        ? node.matchTerms
        : fallback?.match?.length
          ? fallback.match
          : [label];
    const kw = rawKw.filter(Boolean).map(String);
    const patterns = kw.map(k => `%${k}%`);
    const lim = Math.max(1, Math.min(limit, 50));

    const contacts = async (kind: string) =>
      this.ds.query(
        `SELECT id, name, handle, email, company, stage, preferred, tags, interests
           FROM crm_contacts
           WHERE kind = $1 AND (
             name ILIKE ANY($2)
             OR COALESCE(interests::text, '') ILIKE ANY($2)
             OR COALESCE(tags::text, '') ILIKE ANY($2))
           ORDER BY preferred DESC, "updatedAt" DESC
           LIMIT $3`,
        [kind, patterns, lim],
      );

    const [buyers, sellers, leads] = await Promise.all([
      contacts('buyer'),
      contacts('seller'),
      this.ds.query(
        `SELECT id, author, "authorDisplay", source, community, "buyerScore",
                intent, interests, url
           FROM discovered_leads
           WHERE status <> 'dismissed' AND (
             COALESCE(interests::text, '') ILIKE ANY($1)
             OR COALESCE(text, '') ILIKE ANY($1)
             OR COALESCE(title, '') ILIKE ANY($1))
           ORDER BY "buyerScore" DESC NULLS LAST
           LIMIT $2`,
        [patterns, lim],
      ),
    ]);

    return { market: label, keywords: kw, buyers, sellers, leads };
  }

  /** Time series for one segment. */
  series(segment: string, sinceDays = 60): Promise<unknown[]> {
    return this.ds.query(
      `SELECT * FROM market_heat_points
         WHERE segment=$1 AND "capturedAt" >= now() - ($2 || ' days')::interval
         ORDER BY "capturedAt" ASC`,
      [segment, String(Math.max(1, Math.min(sinceDays, 365)))],
    );
  }

  /**
   * Simple momentum forecast — a least-squares trend fit on each topic's recent
   * heat (and median ask) history, projected `horizonDays` ahead. Honest about
   * confidence: few points / poor fit → low or "insufficient". Sharpens as
   * snapshots accrue. Sorted by biggest expected rise.
   */
  async forecast(scope?: string, market?: string, horizonDays = 7): Promise<unknown[]> {
    const conds: string[] = [`h."capturedAt" >= now() - interval '60 days'`];
    const params: string[] = [];
    if (scope && scope !== 'all') {
      params.push(scope);
      conds.push(`h.scope = $${params.length}`);
    }
    if (market && market !== 'all') {
      params.push(market);
      conds.push(`t."rootMarket" = $${params.length}`);
    }
    const rows: {
      segment: string;
      scope: string;
      label: string | null;
      capturedAt: string;
      heatScore: number | null;
      medianAskUsd: number | null;
      rootMarket: string | null;
      taxKind: string | null;
    }[] = await this.ds.query(
      `SELECT h.segment, h.scope, h.label, h."capturedAt", h."heatScore", h."medianAskUsd",
              t."rootMarket", t.kind AS "taxKind"
         FROM market_heat_points h
         LEFT JOIN market_taxonomy t ON t.key = h.segment
        WHERE ${conds.join(' AND ')}
        ORDER BY h.segment, h."capturedAt" ASC`,
      params,
    );

    const horizon = Math.max(1, Math.min(Number.isFinite(horizonDays) ? horizonDays : 7, 30));
    const bySeg = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!bySeg.has(r.segment)) bySeg.set(r.segment, []);
      bySeg.get(r.segment)!.push(r);
    }

    const out: Record<string, unknown>[] = [];
    for (const [segment, pts] of bySeg) {
      const t0 = new Date(pts[0].capturedAt).getTime();
      const dayIdx = (ts: string) => (new Date(ts).getTime() - t0) / 86400000;
      const last = pts[pts.length - 1];
      const xLast = dayIdx(last.capturedAt);
      const currentHeat = last.heatScore != null ? Number(last.heatScore) : null;
      const currentAsk = last.medianAskUsd != null ? Number(last.medianAskUsd) : null;

      const heatFit = fitLine(
        pts.filter(p => p.heatScore != null).map(p => ({ x: dayIdx(p.capturedAt), y: Number(p.heatScore) })),
      );
      const askFit = fitLine(
        pts
          .filter(p => p.medianAskUsd != null && Number(p.medianAskUsd) > 0)
          .map(p => ({ x: dayIdx(p.capturedAt), y: Number(p.medianAskUsd) })),
      );

      let projectedHeat: number | null = null;
      let slopePerWeek: number | null = null;
      let direction = 'flat';
      let confidence = 'insufficient';
      // ≥2 points define a momentum (rate of change); confidence tiers reflect
      // how much history + fit quality backs it, so 2-point reads are honestly
      // flagged "low" and firm up to "medium"/"high" as snapshots accrue.
      if (heatFit && heatFit.n >= 2) {
        slopePerWeek = Math.round(heatFit.slope * 7 * 10) / 10;
        confidence = heatFit.n >= 7 && heatFit.r2 >= 0.5 ? 'high' : heatFit.n >= 4 ? 'medium' : 'low';
        const raw = clamp(heatFit.intercept + heatFit.slope * (xLast + horizon), 0, 100);
        // Damp thin-history extrapolation: cap how far a low-confidence trend
        // can project, so a 2-point slope can't shoot to 0/100.
        const cap = confidence === 'high' ? 40 : confidence === 'medium' ? 25 : 15;
        const base = currentHeat ?? raw;
        const capped = Math.max(-cap, Math.min(cap, raw - base));
        projectedHeat = Math.round(clamp(base + capped, 0, 100));
        const delta = currentHeat != null ? projectedHeat - currentHeat : 0;
        direction = delta >= 5 ? 'rising' : delta <= -5 ? 'cooling' : 'flat';
      }

      let projectedAskUsd: number | null = null;
      let askChangePct: number | null = null;
      if (askFit && askFit.n >= 2 && currentAsk && currentAsk > 0) {
        const projAsk = Math.max(0, askFit.intercept + askFit.slope * (xLast + horizon));
        // Same damping for price — cap the projected swing at ±40%.
        const pct = Math.max(-40, Math.min(40, ((projAsk - currentAsk) / currentAsk) * 100));
        askChangePct = Math.round(pct * 10) / 10;
        projectedAskUsd = Math.round(currentAsk * (1 + pct / 100) * 100) / 100;
      }

      out.push({
        segment,
        label: last.label,
        scope: last.scope,
        rootMarket: last.rootMarket,
        taxKind: last.taxKind,
        points: pts.length,
        horizonDays: horizon,
        currentHeat,
        projectedHeat,
        heatDelta: currentHeat != null && projectedHeat != null ? projectedHeat - currentHeat : null,
        slopePerWeek,
        direction,
        confidence,
        currentAskUsd: currentAsk,
        projectedAskUsd,
        askChangePct,
        asOf: last.capturedAt,
      });
    }

    // Biggest expected rise first; insufficient/unknown sink to the bottom.
    out.sort((a, b) => Number(b.heatDelta ?? -999) - Number(a.heatDelta ?? -999));
    return out;
  }
}
