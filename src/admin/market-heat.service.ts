import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { EbayBrowseSource } from './card-market/ebay-browse.source';
import { AcquisitionService } from './acquisition/acquisition.service';
import { MarketTaxonomyService } from './market-taxonomy.service';
import {
  AUTO_NODES_MAX,
  AUTO_PROMOTE_PER_DAY,
  BASELINE_MIN_AGE_HOURS,
  CHEAP_SAMPLE,
  WATCH_CAP,
  WATCH_HOURS_DISCOVERED,
  WATCH_HOURS_FLAGGED,
  parseVariant,
  scoreSpike,
  variantMove,
  type SpikeInputs,
  type SpikeKey,
  type SpikeSignal,
} from './spike-radar';

export interface HeatTopic {
  key: string;
  scope: 'segment' | 'set' | 'card' | 'player';
  label: string;
  /** eBay search that samples this market's active listings. */
  query: string;
  /** Keywords to attribute first-party tracked cards (empty = match all). */
  match: string[];
  /** Taxonomy root market ('sports', 'pokemon', …) — shapes card-number parsing. */
  rootMarket?: string | null;
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

/** A market_taxonomy row as selected for snapshotting. */
interface TopicRow {
  key: string;
  heatScope: HeatTopic['scope'] | null;
  label: string;
  query: string;
  matchTerms: string[] | null;
  rootMarket: string | null;
}

const toTopic = (r: TopicRow): HeatTopic => ({
  key: r.key,
  scope: r.heatScope ?? 'segment',
  label: r.label,
  query: r.query,
  match: Array.isArray(r.matchTerms) ? r.matchTerms : [],
  rootMarket: r.rootMarket,
});

/**
 * Topics in Spike Radar watch mode, hottest first, skipping any snapshotted in
 * the last 45 min (so the daily run and a manual refresh don't double up).
 */
export async function loadWatchedTopics(ds: DataSource, limit: number): Promise<HeatTopic[]> {
  const now = new Date();
  const rows: TopicRow[] = await ds.query(
    `SELECT t.key, t."heatScope", t.label, t.query, t."matchTerms", t."rootMarket"
       FROM market_taxonomy t
       LEFT JOIN LATERAL (
         SELECT h."capturedAt", h."spikeScore" FROM market_heat_points h
          WHERE h.segment = t.key ORDER BY h."capturedAt" DESC LIMIT 1
       ) last ON true
      WHERE t.active = true AND t.query IS NOT NULL AND t."heatScope" IS NOT NULL
        AND t."watchUntil" > $1
        AND (last."capturedAt" IS NULL OR last."capturedAt" < $1::timestamp - interval '45 minutes')
      ORDER BY last."spikeScore" DESC NULLS LAST, t."watchUntil" DESC
      LIMIT $2`,
    [now, limit],
  );
  return rows.map(toTopic);
}

/**
 * Load the live snapshot topics from the taxonomy — every active node that
 * carries an eBay query and a heat scope (markets, sets, players, marquee
 * cards). Adding a node there is all it takes to start tracking a new market.
 * Falls back to the hardcoded HEAT_TOPICS if the table is empty/absent.
 */
export async function loadHeatTopics(ds: DataSource): Promise<HeatTopic[]> {
  try {
    const rows: TopicRow[] = await ds.query(
      `SELECT key, "heatScope", label, query, "matchTerms", "rootMarket"
         FROM market_taxonomy
        WHERE active = true AND query IS NOT NULL AND "heatScope" IS NOT NULL
        ORDER BY "heatScope", "sortOrder", label`,
    );
    if (rows && rows.length) return rows.map(toTopic);
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

/** Inputs to the heat score — all stored on each heat point. */
export interface HeatInputs {
  clearedRatePct: number | null;
  askChangePct: number | null;
  agingPct: number | null;
  totalActiveChangePct: number | null;
  socialMentions?: number | null;
  firstPartyAdds?: number | null;
  /** Topic scope + eBay's live listing count — scarcity only scores for single cards. */
  scope?: string | null;
  totalActive?: number | null;
}

export type HeatDriverKey =
  | 'price'
  | 'supply'
  | 'listed'
  | 'sellThrough'
  | 'freshness'
  | 'buzz'
  | 'tracking';

/**
 * Single-card scarcity from how many copies are listed, on a log scale:
 * 10 or fewer → 100, 100,000+ → 0, and each 10× more listings costs 25.
 */
const scarcityScore = (listed: number) =>
  clamp(((5 - Math.log10(Math.max(1, listed))) / 4) * 100, 0, 100);

/**
 * One sub-score of the heat score. `score` is 0-100 on its own scale (for price
 * and supply, 50 = flat); `share` is the fraction of the blend it carried.
 */
export interface HeatDriver {
  key: HeatDriverKey;
  score: number;
  weight: number;
  share: number;
}

/**
 * The components the heat score blends, unrounded. Each degrades gracefully —
 * a component with no data yet is simply left out and the rest re-weighted.
 */
function heatComponents(x: HeatInputs): { key: HeatDriverKey; v: number; w: number }[] {
  // Weights favour the robust aggregate signals (price + supply momentum) over
  // the page-level sample velocity/aging, which is noisier (Best-Match churn).
  const comps: { key: HeatDriverKey; v: number; w: number }[] = [];
  if (x.askChangePct != null)
    comps.push({ key: 'price', v: clamp(50 + x.askChangePct * 2.5, 0, 100), w: 0.3 }); // price momentum (robust)
  if (x.totalActiveChangePct != null)
    comps.push({ key: 'supply', v: clamp(50 - x.totalActiveChangePct * 2, 0, 100), w: 0.3 }); // supply momentum (robust)
  // Supply LEVEL (scarcity) only means something for a single card — a whole
  // market with millions of listings isn't "scarce" in any useful sense.
  if (x.scope === 'card' && x.totalActive != null && x.totalActive > 0)
    comps.push({ key: 'listed', v: scarcityScore(x.totalActive), w: 0.15 }); // card scarcity
  if (x.clearedRatePct != null)
    comps.push({ key: 'sellThrough', v: clamp((x.clearedRatePct / 40) * 100, 0, 100), w: 0.15 }); // sell-through (noisy)
  // Aging only counts once some listings have actually aged. On a freshly
  // tracked market everything looks un-aged (agingPct 0), which would wrongly
  // read as hot, so we skip it until real sitting time shows up.
  if (x.agingPct != null && x.agingPct > 0)
    comps.push({ key: 'freshness', v: clamp(100 - x.agingPct, 0, 100), w: 0.1 }); // less sitting (noisy)
  if (x.socialMentions != null)
    comps.push({ key: 'buzz', v: clamp((x.socialMentions / 50) * 100, 0, 100), w: 0.15 }); // social buzz
  if (x.firstPartyAdds != null && x.firstPartyAdds > 0)
    comps.push({ key: 'tracking', v: clamp((x.firstPartyAdds / 5) * 100, 0, 100), w: 0.1 }); // our saves/follows
  return comps;
}

/** A score needs day-over-day momentum (a prior snapshot to compare against). */
const hasMomentum = (x: HeatInputs) =>
  x.clearedRatePct != null || x.askChangePct != null || x.totalActiveChangePct != null;

/** The heat score's sub-scores, or null when there's no score (first snapshot). */
export function heatDrivers(x: HeatInputs): HeatDriver[] | null {
  const comps = heatComponents(x);
  if (comps.length === 0 || !hasMomentum(x)) return null;
  const wsum = comps.reduce((s, c) => s + c.w, 0);
  return comps.map(c => ({
    key: c.key,
    score: Math.round(c.v),
    weight: c.w,
    share: c.w / wsum,
  }));
}

/**
 * Sub-scores for a stored heat point (a market_heat_points row): the ones saved
 * with it, else recomputed from its stored inputs. Points saved before the
 * current weights may not blend back to their exact stored score.
 */
export function pointHeatDrivers(r: Record<string, unknown>): HeatDriver[] | null {
  if (r.heatScore == null) return null;
  const extra = (r.extra ?? null) as {
    social?: { mentions?: number | null } | null;
    firstParty?: { recentAdds?: number } | null;
    drivers?: HeatDriver[] | null;
  } | null;
  if (Array.isArray(extra?.drivers)) return extra.drivers;
  return heatDrivers({
    clearedRatePct: num(r.clearedRatePct),
    askChangePct: num(r.askChangePct),
    agingPct: num(r.agingPct),
    totalActiveChangePct: num(r.totalActiveChangePct),
    socialMentions: num(extra?.social?.mentions),
    firstPartyAdds: num(extra?.firstParty?.recentAdds),
    scope: typeof r.scope === 'string' ? r.scope : null,
    totalActive: num(r.totalActive),
  });
}

/**
 * Composite 0-100 heat from the leading indicators (see heatComponents).
 * Day 1 (no prior snapshot) returns null; velocity and price/supply momentum
 * kick in once history exists. Weights are tunable.
 */
export function computeHeat(x: HeatInputs): number | null {
  const comps = heatComponents(x);
  // Without momentum — i.e. a market's very first snapshot — we return null
  // ("new") instead of a spurious high score; it fills in on the next run.
  if (comps.length === 0 || !hasMomentum(x)) return null;

  const wsum = comps.reduce((s, c) => s + c.w, 0);
  const raw = comps.reduce((s, c) => s + c.v * c.w, 0) / wsum;
  // Soft ceiling: leave headroom at the top so scores don't pile up at 100.
  // Scores up to 80 are untouched; the hot end above 80 is gently compressed.
  const scaled = raw <= 80 ? raw : 80 + (raw - 80) * 0.6;
  return Math.round(scaled);
}

/** One end of the all-time record: the reading that set it. */
export interface HeatRecord {
  score: number;
  segment: string;
  label: string | null;
  capturedAt: string;
}

/**
 * Site-wide record scale for the heat index: 100 = the hottest raw reading
 * ever recorded (any topic, any scope), 0 = the coldest. `floor`/`ceiling` are
 * the effective raw bounds the index is mapped across.
 */
export interface HeatScale {
  floor: number;
  ceiling: number;
  high: HeatRecord;
  low: HeatRecord;
  readings: number;
}

/**
 * The record scale is never stretched over fewer raw points than this, so a
 * thin history (e.g. everything between 47 and 52) can't blow a 2-point gap
 * up into 0 vs. 100. Widened downward so 100 always stays the true record.
 */
const MIN_SCALE_SPAN = 20;

/** Raw heat → 0-100 index on the record scale. Passes raw through with no scale. */
export function toHeatIndex(raw: number | null | undefined, s: HeatScale | null): number | null {
  if (raw == null) return null;
  if (!s) return raw;
  return Math.round(clamp(((raw - s.floor) / (s.ceiling - s.floor)) * 100, 0, 100));
}

/** Raw heat change → change in index points on the record scale. */
export function toHeatIndexDelta(delta: number | null | undefined, s: HeatScale | null): number | null {
  if (delta == null) return null;
  if (!s) return delta;
  return Math.round((delta / (s.ceiling - s.floor)) * 100);
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
  spikeScore: number | null;
  flagged: boolean;
  /** Specific cards auto-added to tracking from this topic this run. */
  promoted: number;
}

/** Options for one topic snapshot. */
export interface CollectOpts {
  social?: SocialBuzzFn;
  /** Hourly watch runs reuse a recent buzz reading instead of re-querying (API quotas). */
  reuseSocialHours?: number;
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
  opts?: CollectOpts,
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

  const [latestPoint] = (await ds.query(
    `SELECT "sampleQuery", "capturedAt", extra FROM market_heat_points
       WHERE segment=$1 ORDER BY "capturedAt" DESC LIMIT 1`,
    [segment],
  )) as { sampleQuery: string | null; capturedAt: Date; extra: PointExtra | null }[];
  // The search was edited since the last snapshot: it's a different listing
  // pool, so start a fresh baseline instead of comparing across searches (which
  // reads as a huge supply/price swing and marks every old listing "sold").
  const queryChanged =
    latestPoint?.sampleQuery != null && latestPoint.sampleQuery !== query;
  if (queryChanged) {
    await ds.query(`DELETE FROM market_listings WHERE segment=$1`, [segment]);
  }

  // Baseline = the latest same-search snapshot at least ~a day old, so hourly
  // watch-mode snapshots still read as "change over the last day" (and heat
  // means the same thing whether a topic is snapshotted daily or hourly). A
  // brand-new topic falls back to its oldest snapshot.
  const cutoff = new Date(runAt.getTime() - BASELINE_MIN_AGE_HOURS * 3600_000);
  const baseCols = `"capturedAt", "medianAskUsd", "totalActive", "floorAskUsd", extra`;
  type BaseRow = {
    capturedAt: Date;
    medianAskUsd: number | null;
    totalActive: number | null;
    floorAskUsd: number | null;
    extra: PointExtra | null;
  };
  let baseline: BaseRow | undefined;
  if (!queryChanged) {
    const sameSearch = `segment=$1 AND ("sampleQuery"=$2 OR "sampleQuery" IS NULL)`;
    baseline =
      ((await ds.query(
        `SELECT ${baseCols} FROM market_heat_points
          WHERE ${sameSearch} AND "capturedAt" <= $3 ORDER BY "capturedAt" DESC LIMIT 1`,
        [segment, query, cutoff],
      )) as BaseRow[])[0] ??
      ((await ds.query(
        `SELECT ${baseCols} FROM market_heat_points
          WHERE ${sameSearch} ORDER BY "capturedAt" ASC LIMIT 1`,
        [segment, query],
      )) as BaseRow[])[0];
  }
  const baseAt = baseline?.capturedAt ?? null;
  const prevMedianAsk = num(baseline?.medianAskUsd);
  const prevTotalActive = num(baseline?.totalActive);
  const prevFloor = num(baseline?.floorAskUsd);

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
         FILTER (WHERE "priceUsd" IS NOT NULL AND "priceUsd" > 0) AS median_ask,
       percentile_cont(0.1) WITHIN GROUP (ORDER BY "priceUsd")
         FILTER (WHERE "priceUsd" IS NOT NULL AND "priceUsd" > 0) AS floor_ask
     FROM market_listings WHERE segment=$1 AND active=true`,
    [segment],
  );
  const sampleActive = num(m?.sample_active) ?? 0;
  const medianDaysListed = num(m?.median_days);
  const agingPct = num(m?.aging_pct);
  const medianAskUsd = num(m?.median_ask);
  // The floor (10th-percentile ask, not the single cheapest — one junk $1
  // listing shouldn't set it). When buyers clear out a card, it moves first.
  const floorAskUsd = num(m?.floor_ask);

  // Sell-through since the baseline: of the listings live back then, the share
  // gone now. Same as "cleared since the last daily run" for a daily topic,
  // and still a ~24h read when watch mode snapshots it hourly.
  let clearedRatePct: number | null = null;
  if (baseAt) {
    const [st] = await ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE "firstSeenAt" <= $2 AND (active OR "clearedAt" > $2))::int AS live_then,
         COUNT(*) FILTER (WHERE "firstSeenAt" <= $2 AND active = false AND "clearedAt" > $2)::int AS gone
       FROM market_listings WHERE segment=$1`,
      [segment, baseAt],
    );
    if (st?.live_then > 0) clearedRatePct = (st.gone / st.live_then) * 100;
  }

  // Floor sweep: of the cheapest copies at the baseline, how many are gone.
  // Buyers clearing out the cheap end is the earliest tell on eBay.
  let sweptPct: number | null = null;
  const baseCheapIds = Array.isArray(baseline?.extra?.cheapIds) ? baseline.extra.cheapIds : [];
  if (baseCheapIds.length >= 5) {
    const [sw] = await ds.query(
      `SELECT COUNT(*)::int AS gone FROM market_listings
        WHERE segment=$1 AND "externalId" = ANY($2::text[]) AND active = false`,
      [segment, baseCheapIds],
    );
    sweptPct = ((sw?.gone ?? 0) / baseCheapIds.length) * 100;
  }
  // Remember today's cheapest copies for tomorrow's sweep check.
  const cheapIds = items
    .filter(i => i.priceUsd != null && i.priceUsd > 0)
    .sort((a, b) => (a.priceUsd as number) - (b.priceUsd as number))
    .slice(0, CHEAP_SAMPLE)
    .map(i => i.externalId);

  const pctChange = (now: number | null, then: number | null) =>
    now && then ? ((now - then) / then) * 100 : null;
  const askChangePct = pctChange(medianAskUsd, prevMedianAsk);
  const totalActiveChangePct = pctChange(total, prevTotalActive);
  const floorChangePct = pctChange(floorAskUsd, prevFloor);

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
  // Watch-mode runs reuse a recent reading — YouTube's search quota can't take
  // an hourly query per watched topic.
  let social: { mentions: number | null; bySource: Record<string, number> } | null = null;
  const reuseHours = opts?.reuseSocialHours ?? 0;
  if (
    reuseHours > 0 &&
    latestPoint?.extra?.social &&
    !queryChanged &&
    runAt.getTime() - new Date(latestPoint.capturedAt).getTime() < reuseHours * 3600_000
  ) {
    social = latestPoint.extra.social;
  } else if (opts?.social) {
    try {
      social = await opts.social(query);
    } catch {
      /* skip social on failure */
    }
  }

  const inputs: HeatInputs = {
    clearedRatePct,
    askChangePct,
    agingPct,
    totalActiveChangePct,
    socialMentions: social?.mentions ?? null,
    firstPartyAdds: firstParty?.recentAdds ?? null,
    scope: topic.scope,
    totalActive: total,
  };
  const heatScore = computeHeat(inputs);

  // Spike Radar: how unusual is today for THIS topic? Judged against its own
  // daily history (older than the baseline, so a spike in progress can't
  // become its own "normal"). Needs a baseline to have anything to compare.
  const spikeIn: SpikeInputs = {
    floorChangePct,
    sweptPct,
    totalActiveChangePct,
    clearedRatePct,
    askChangePct,
    socialMentions: social?.mentions ?? null,
    firstPartyAdds: firstParty?.recentAdds ?? null,
  };
  const spike = baseAt ? scoreSpike(spikeIn, await loadSpikeHistory(ds, segment, query, cutoff)) : null;

  // Store the sub-scores that produced this score, so the breakdown stays
  // exact even if the weights are retuned later.
  const extra: PointExtra = { social, firstParty, drivers: heatDrivers(inputs), cheapIds };

  await ds.query(
    `INSERT INTO market_heat_points
       (segment, scope, label, "capturedAt", "totalActive", "totalActiveChangePct",
        "sampleActive", "newCount", "clearedCount", "clearedRatePct", "medianDaysListed",
        "agingPct", "medianAskUsd", "askChangePct", "heatScore", "sampleQuery", extra,
        "floorAskUsd", "floorChangePct", "sweptPct", "spikeScore", "spikeSignals")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,
             $18,$19,$20,$21,$22::jsonb)`,
    [
      segment, topic.scope, topic.label, runAt, total, totalActiveChangePct,
      sampleActive, newCount, clearedCount, clearedRatePct, medianDaysListed,
      agingPct, medianAskUsd, askChangePct, heatScore, query, JSON.stringify(extra),
      floorAskUsd, floorChangePct, sweptPct, spike?.score ?? null,
      spike ? JSON.stringify(spike.signals) : null,
    ],
  );

  // Flagged → hourly watch mode for the next 48h, so we see the move unfold.
  if (spike?.flagged) {
    const why = spike.signals
      .filter(s => s.firing)
      .map(s => SPIKE_LABELS[s.key])
      .join(', ');
    await extendWatch(ds, segment, runAt, WATCH_HOURS_FLAGGED, `radar: ${why || 'unusual day'}`);
  }

  // Break the topic down into the specific cards inside it (not for whole
  // markets — too broad to repeat — and not for already-specific auto cards).
  let promoted = 0;
  if (topic.scope !== 'segment' && !segment.startsWith('auto_')) {
    try {
      promoted = await collectVariants(ds, topic, items, runAt, baseAt);
    } catch {
      /* the breakdown is a bonus — never fail the snapshot over it */
    }
  }

  return {
    segment,
    label: topic.label,
    totalActive: total,
    sampleActive,
    newCount,
    clearedCount,
    heatScore,
    medianAskUsd,
    spikeScore: spike?.score ?? null,
    flagged: !!spike?.flagged,
    promoted,
  };
}

/** What a heat point keeps in its `extra` jsonb. */
interface PointExtra {
  social?: { mentions: number | null; bySource: Record<string, number> } | null;
  firstParty?: { recentAdds: number; recentWatches: number } | null;
  drivers?: HeatDriver[] | null;
  /** The cheapest listings at this snapshot, for the next one's sweep check. */
  cheapIds?: string[];
}

/** One topic as the Spike Radar shows it. */
export interface RadarItem {
  segment: string;
  label: string;
  scope: string;
  rootMarket: string | null;
  parentKey: string | null;
  capturedAt: string;
  /** Heat on the record-scale index (0-100). */
  heat: number | null;
  spikeScore: number | null;
  firing: number;
  flagged: boolean;
  signals: SpikeSignal[];
  floorAskUsd: number | null;
  floorChangePct: number | null;
  sweptPct: number | null;
  totalActive: number | null;
  /** Auto-discovered specific card. */
  auto: boolean;
  watchUntil: Date | null;
  watchReason: string | null;
}

/** A market_variant_points row as the radar reads it. */
interface VariantRow {
  segment: string;
  signature: string;
  label: string;
  capturedAt: string;
  listedCount: number;
  floorUsd: number | null;
  medianUsd: number | null;
  clearedCount: number;
  floorChangePct: number | null;
  countChangePct: number | null;
  hot: boolean;
  extra: Record<string, unknown> | null;
  topicLabel?: string | null;
  rootMarket?: string | null;
}

export interface RadarResponse {
  asOf: string;
  spiking: RadarItem[];
  catchUp: { of: { segment: string; label: string }; items: RadarItem[] }[];
  discoveries: {
    segment: string;
    topicLabel: string;
    signature: string;
    label: string;
    capturedAt: string;
    listedCount: number;
    floorUsd: number | null;
    medianUsd: number | null;
    clearedCount: number;
    floorChangePct: number | null;
    countChangePct: number | null;
    stillHot: boolean;
    sampleUrl: string | null;
    trackedKey: string | null;
    notYetMoved: { signature: string; label: string; listedCount: number; floorUsd: number | null }[];
  }[];
  watching: {
    segment: string;
    label: string;
    kind: string;
    watchUntil: Date;
    watchReason: string | null;
    spikeScore: number | null;
    lastSnapshotAt: string | null;
  }[];
  budget: { snapshots24h: number; watchCap: number; watching: number };
}

/** Plain-English names for spike signals (watch reasons, UI). */
export const SPIKE_LABELS: Record<SpikeKey, string> = {
  floor: 'floor up',
  sweep: 'cheap copies bought',
  supply: 'listings draining',
  sellThrough: 'selling fast',
  price: 'asks rising',
  buzz: 'buzz spiking',
  tracking: 'our users adding',
};

/**
 * One reading per day (the day's last) from the 30 days before `before`, same
 * search only — the "normal" a topic's latest readings are judged against.
 */
async function loadSpikeHistory(
  ds: DataSource,
  segment: string,
  query: string,
  before: Date,
): Promise<SpikeInputs[]> {
  const rows: {
    floorChangePct: number | null;
    sweptPct: number | null;
    totalActiveChangePct: number | null;
    clearedRatePct: number | null;
    askChangePct: number | null;
    extra: PointExtra | null;
  }[] = await ds.query(
    `SELECT DISTINCT ON ("capturedAt"::date)
            "floorChangePct", "sweptPct", "totalActiveChangePct", "clearedRatePct",
            "askChangePct", extra
       FROM market_heat_points
      WHERE segment=$1 AND ("sampleQuery"=$2 OR "sampleQuery" IS NULL)
        AND "capturedAt" < $3 AND "capturedAt" >= $3::timestamp - interval '30 days'
      ORDER BY "capturedAt"::date, "capturedAt" DESC`,
    [segment, query, before],
  );
  return rows.map(r => ({
    floorChangePct: num(r.floorChangePct),
    sweptPct: num(r.sweptPct),
    totalActiveChangePct: num(r.totalActiveChangePct),
    clearedRatePct: num(r.clearedRatePct),
    askChangePct: num(r.askChangePct),
    socialMentions: num(r.extra?.social?.mentions),
    firstPartyAdds: num(r.extra?.firstParty?.recentAdds),
  }));
}

/**
 * Put a topic in hourly watch mode until at least `hours` from `from`. Never
 * shortens an existing watch; keeps the original reason while one is running.
 */
export async function extendWatch(
  ds: DataSource,
  key: string,
  from: Date,
  hours: number,
  reason: string,
): Promise<void> {
  const until = new Date(from.getTime() + hours * 3600_000);
  await ds.query(
    `UPDATE market_taxonomy
        SET "watchReason" = CASE WHEN "watchUntil" IS NULL OR "watchUntil" < $3 THEN $4 ELSE "watchReason" END,
            "watchUntil" = GREATEST(COALESCE("watchUntil", $2), $2),
            "updatedAt" = now()
      WHERE key = $1`,
    [key, until, from, reason.slice(0, 160)],
  );
}

/** Stable, ≤64-char taxonomy key for an auto-discovered card. */
export function autoKey(segment: string, signature: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const key = `auto_${slug(segment)}_${slug(signature)}`;
  if (key.length <= 64) return key;
  // Too long: truncate and keep it unique with a short hash of the full key.
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return `${key.slice(0, 56)}_${h.toString(36).slice(0, 7)}`;
}

/**
 * Break one topic's sampled listings down into specific cards, store each
 * card's reading, and auto-track any that are lighting up. Returns how many
 * were newly added to tracking.
 */
async function collectVariants(
  ds: DataSource,
  topic: HeatTopic,
  items: { externalId: string; title: string | null; priceUsd: number | null; url: string | null }[],
  runAt: Date,
  baseAt: Date | null,
): Promise<number> {
  const sports = topic.rootMarket === 'sports';
  type Group = { label: string; queryTerms: string; prices: number[]; n: number; title: string | null; url: string | null };
  const groups = new Map<string, Group>();
  for (const it of items) {
    const v = parseVariant(it.title, { sports });
    if (!v) continue;
    const g = groups.get(v.signature) ?? {
      label: v.label,
      queryTerms: v.queryTerms,
      prices: [],
      n: 0,
      title: it.title,
      url: it.url,
    };
    g.n++;
    if (it.priceUsd != null && it.priceUsd > 0) g.prices.push(it.priceUsd);
    groups.set(v.signature, g);
  }

  // Copies live at the baseline that are gone now, per card.
  const gone = new Map<string, number>();
  let base = new Map<string, { listedCount: number; floorUsd: number | null }>();
  if (baseAt) {
    const goneRows: { title: string | null }[] = await ds.query(
      `SELECT title FROM market_listings
        WHERE segment=$1 AND "firstSeenAt" <= $2 AND active = false AND "clearedAt" > $2`,
      [topic.key, baseAt],
    );
    for (const r of goneRows) {
      const v = parseVariant(r.title, { sports });
      if (v) gone.set(v.signature, (gone.get(v.signature) ?? 0) + 1);
    }
    const baseRows: { signature: string; listedCount: number; floorUsd: number | null }[] = await ds.query(
      `SELECT DISTINCT ON (signature) signature, "listedCount", "floorUsd"
         FROM market_variant_points
        WHERE segment=$1 AND "capturedAt" <= $2
        ORDER BY signature, "capturedAt" DESC`,
      [topic.key, baseAt],
    );
    base = new Map(baseRows.map(r => [r.signature, { listedCount: r.listedCount, floorUsd: num(r.floorUsd) }]));
  }

  // Cards that sold out entirely still count — that's the strongest tell.
  for (const sig of gone.keys()) {
    if (!groups.has(sig) && (base.get(sig)?.listedCount ?? 0) >= 3) {
      groups.set(sig, { label: '', queryTerms: '', prices: [], n: 0, title: null, url: null });
    }
  }

  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const rows = [...groups.entries()]
    .map(([signature, g]) => {
      const cleared = gone.get(signature) ?? 0;
      const reading = { listedCount: g.n, floorUsd: g.prices.length ? Math.min(...g.prices) : null, clearedCount: cleared };
      return { signature, g, reading, move: variantMove(reading, base.get(signature) ?? null) };
    })
    // Keep cards with enough copies to read, plus anything moving.
    .filter(r => r.g.n >= 2 || r.reading.clearedCount >= 2 || r.move.hot)
    .sort((a, b) => Number(b.move.hot) - Number(a.move.hot) || b.g.n - a.g.n)
    .slice(0, 40);

  let promoted = 0;
  for (const r of rows) {
    // A sold-out card has no title this run — reuse the last stored label.
    if (!r.g.label) {
      const [prev] = await ds.query(
        `SELECT label, extra FROM market_variant_points WHERE segment=$1 AND signature=$2
          ORDER BY "capturedAt" DESC LIMIT 1`,
        [topic.key, r.signature],
      );
      r.g.label = prev?.label ?? r.signature;
      r.g.queryTerms = (prev?.extra?.queryTerms as string) ?? '';
    }
    let promotedKey: string | null = null;
    if (r.move.hot && r.g.queryTerms) {
      promotedKey = await promoteVariant(ds, topic, r.signature, r.g.label, r.g.queryTerms, runAt, false);
      if (promotedKey) promoted++;
    }
    await ds.query(
      `INSERT INTO market_variant_points
         (segment, signature, label, "capturedAt", "listedCount", "floorUsd", "medianUsd",
          "clearedCount", "floorChangePct", "countChangePct", hot, extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        topic.key,
        r.signature.slice(0, 160),
        r.g.label.slice(0, 160),
        runAt,
        r.g.n,
        r.reading.floorUsd,
        median(r.g.prices),
        r.reading.clearedCount,
        r.move.floorChangePct,
        r.move.countChangePct,
        r.move.hot,
        JSON.stringify({
          queryTerms: r.g.queryTerms,
          sampleTitle: r.g.title,
          sampleUrl: r.g.url,
          promotedKey,
        }),
      ],
    );
  }
  return promoted;
}

/**
 * Add a specific card found inside `topic` to tracking as its own card topic,
 * in watch mode. Auto-promotion is capped per day and in total so a noisy day
 * can't flood the taxonomy; `manual` (a person clicked "Track") skips the
 * daily cap. Returns the new key, or null if capped / already tracked.
 */
export async function promoteVariant(
  ds: DataSource,
  topic: HeatTopic,
  signature: string,
  label: string,
  queryTerms: string,
  runAt: Date,
  manual: boolean,
): Promise<string | null> {
  const key = autoKey(topic.key, signature);
  const [counts] = await ds.query(
    `SELECT COUNT(*) FILTER (WHERE active)::int AS total,
            COUNT(*) FILTER (WHERE "createdAt" > $1)::int AS today,
            COUNT(*) FILTER (WHERE key = $2)::int AS exists
       FROM market_taxonomy WHERE key LIKE 'auto\\_%'`,
    [new Date(runAt.getTime() - 24 * 3600_000), key],
  );
  if (counts?.exists > 0) return null;
  if ((counts?.total ?? 0) >= AUTO_NODES_MAX) return null;
  if (!manual && (counts?.today ?? 0) >= AUTO_PROMOTE_PER_DAY) return null;

  const until = new Date(runAt.getTime() + WATCH_HOURS_DISCOVERED * 3600_000);
  const fullLabel = `${topic.label} · ${label}`.slice(0, 160);
  const inserted: { key: string }[] = await ds.query(
    `INSERT INTO market_taxonomy
       (kind, "rootMarket", "parentKey", key, label, "matchTerms", query, "heatScope",
        curated, active, "sortOrder", extra, "watchUntil", "watchReason")
     VALUES ('card', $1, $2, $3, $4, '[]'::jsonb, $5, 'card', false, true, 0, $6::jsonb, $7, $8)
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [
      topic.rootMarket ?? topic.key,
      topic.key,
      key,
      fullLabel,
      `${topic.query} ${queryTerms}`.slice(0, 200),
      JSON.stringify({ auto: true, from: topic.key, signature, manual }),
      until,
      (manual ? 'tracked from Spike Radar' : `discovered in ${topic.label}`).slice(0, 160),
    ],
  );
  return inserted[0]?.key ?? null;
}

/** Snapshot every topic (sequential — gentle on the eBay rate limit). */
export async function collectMarketHeat(
  ds: DataSource,
  ebay: EbayBrowseSource,
  opts?: CollectOpts,
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

  private watchRunning = false;

  constructor(
    private readonly ds: DataSource,
    private readonly ebay: EbayBrowseSource,
    private readonly acquisition: AcquisitionService,
    private readonly taxonomy: MarketTaxonomyService,
  ) {}

  /** Enrichment probes handed to the core collector. */
  private get opts(): CollectOpts {
    return { social: (q: string) => this.acquisition.buzzVolume(q) };
  }

  /** Auto-discovered cards were added behind the taxonomy service's back. */
  private afterRun(results: CollectResult[]): CollectResult[] {
    if (results.some(r => r.promoted > 0)) this.taxonomy.refresh();
    return results;
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async collectDaily(): Promise<void> {
    if (!this.ebay.isConfigured()) return;
    const started = Date.now();
    const r = this.afterRun(await collectMarketHeat(this.ds, this.ebay, this.opts));
    this.logger.log(
      `Market-heat: snapshotted ${r.length} segment(s) in ${Date.now() - started}ms`,
    );
  }

  /**
   * Spike Radar watch mode: every hour, re-snapshot the topics being watched
   * (flagged by the radar, discovered, or pinned by hand) — at most WATCH_CAP
   * per run, hottest first, so the eBay daily call budget holds.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async collectWatched(): Promise<void> {
    if (this.watchRunning || !this.ebay.isConfigured()) return;
    this.watchRunning = true;
    try {
      const started = Date.now();
      const topics = await loadWatchedTopics(this.ds, WATCH_CAP);
      const out: CollectResult[] = [];
      for (const t of topics) {
        try {
          const r = await collectTopic(this.ds, this.ebay, t, { ...this.opts, reuseSocialHours: 12 });
          if (r) out.push(r);
        } catch {
          /* one topic failing must not stop the rest */
        }
      }
      this.afterRun(out);
      if (out.length) {
        this.logger.log(
          `Spike Radar: watch-snapshotted ${out.length} topic(s), ${out.filter(r => r.flagged).length} flagged, ` +
            `${out.reduce((s, r) => s + r.promoted, 0)} discovered, in ${Date.now() - started}ms`,
        );
      }
    } finally {
      this.watchRunning = false;
    }
  }

  async collectAll(): Promise<CollectResult[]> {
    return this.afterRun(await collectMarketHeat(this.ds, this.ebay, this.opts));
  }

  private async topicByKey(key: string): Promise<HeatTopic | null> {
    const rows: TopicRow[] = await this.ds.query(
      `SELECT key, "heatScope", label, query, "matchTerms", "rootMarket"
         FROM market_taxonomy
        WHERE key = $1 AND active = true AND query IS NOT NULL
        LIMIT 1`,
      [key],
    );
    return rows[0] ? toTopic(rows[0]) : null;
  }

  /**
   * Snapshot a SINGLE taxonomy topic now — used right after a user adds a new
   * player/card/set from the heat panel, so it shows data immediately instead
   * of waiting for the nightly cron.
   */
  async collectOne(key: string): Promise<CollectResult | null> {
    if (!this.ebay.isConfigured()) return null;
    const topic = await this.topicByKey(key);
    if (!topic) return null;
    const r = await collectTopic(this.ds, this.ebay, topic, this.opts);
    return r ? this.afterRun([r])[0] : null;
  }

  // ------------------------------------------------------------ Spike Radar ---

  /** Pin a topic to hourly watch mode for `hours` (never shortens a longer watch). */
  async setWatch(key: string, hours: number): Promise<{ key: string; watchUntil: Date }> {
    const h = Math.max(1, Math.min(Number.isFinite(hours) ? hours : 72, 24 * 14));
    const now = new Date();
    await extendWatch(this.ds, key, now, h, 'watched by hand');
    // A hand-picked watch should start now, not at the next hourly run.
    void this.collectOne(key).catch(() => null);
    const [row] = await this.ds.query(`SELECT "watchUntil" FROM market_taxonomy WHERE key = $1`, [key]);
    return { key, watchUntil: row?.watchUntil ?? new Date(now.getTime() + h * 3600_000) };
  }

  async clearWatch(key: string): Promise<{ key: string }> {
    await this.ds.query(
      `UPDATE market_taxonomy SET "watchUntil" = NULL, "watchReason" = NULL, "updatedAt" = now() WHERE key = $1`,
      [key],
    );
    return { key };
  }

  /**
   * Track a specific card found by the radar (a person clicked "Track"), then
   * snapshot it right away. Skips the daily auto-discovery cap.
   */
  async promote(segment: string, signature: string): Promise<{ key: string | null }> {
    const topic = await this.topicByKey(segment);
    if (!topic) return { key: null };
    const [v] = await this.ds.query(
      `SELECT label, extra FROM market_variant_points WHERE segment=$1 AND signature=$2
        ORDER BY "capturedAt" DESC LIMIT 1`,
      [segment, signature],
    );
    if (!v) return { key: null };
    const key =
      (await promoteVariant(
        this.ds,
        topic,
        signature,
        v.label,
        (v.extra?.queryTerms as string) ?? '',
        new Date(),
        true,
      )) ?? autoKey(segment, signature);
    this.taxonomy.refresh();
    void this.collectOne(key).catch(() => null);
    return { key };
  }

  /**
   * Everything the Spike Radar panel shows: what's spiking right now (judged
   * against each topic's own normal), the not-yet-moved siblings of each
   * (rotation catch-up), specific cards found lighting up inside tracked
   * topics, and the hourly watch list.
   */
  async radar(): Promise<RadarResponse> {
    const now = new Date();
    const since48h = new Date(now.getTime() - 48 * 3600_000);
    const since72h = new Date(now.getTime() - 72 * 3600_000);

    const [all, scale] = await Promise.all([this.latest(), this.scale()]);
    const watchByKey = new Map<string, { watchUntil: Date | null; watchReason: string | null }>(
      ((await this.ds.query(
        `SELECT key, "watchUntil", "watchReason" FROM market_taxonomy WHERE "watchUntil" > $1`,
        [now],
      )) as { key: string; watchUntil: Date; watchReason: string | null }[]).map(r => [r.key, r]),
    );

    const toItem = (r: Record<string, unknown>): RadarItem => {
      const signals = (Array.isArray(r.spikeSignals) ? r.spikeSignals : []) as SpikeSignal[];
      const firing = signals.filter(s => s.firing).length;
      const score = r.spikeScore == null ? null : Number(r.spikeScore);
      const w = watchByKey.get(r.segment as string);
      return {
        segment: r.segment as string,
        label: (r.label as string) ?? (r.segment as string),
        scope: r.scope as string,
        rootMarket: (r.rootMarket as string) ?? null,
        parentKey: (r.parentKey as string) ?? null,
        capturedAt: r.capturedAt as string,
        heat: toHeatIndex(r.heatScore as number | null, scale),
        spikeScore: score,
        firing,
        flagged: score != null && (firing >= 2 || score >= 60),
        signals,
        floorAskUsd: num(r.floorAskUsd),
        floorChangePct: num(r.floorChangePct),
        sweptPct: num(r.sweptPct),
        totalActive: num(r.totalActive),
        auto: (r.segment as string).startsWith('auto_'),
        watchUntil: w?.watchUntil ?? null,
        watchReason: w?.watchReason ?? null,
      };
    };

    const items = all.map(toItem);
    const recent = items.filter(i => new Date(i.capturedAt) >= since48h);
    const spiking = recent
      .filter(i => i.flagged || (i.spikeScore ?? 0) >= 30)
      .sort((a, b) => Number(b.flagged) - Number(a.flagged) || (b.spikeScore ?? 0) - (a.spikeScore ?? 0))
      .slice(0, 25);

    // Rotation catch-up: when one card in a family spikes, its siblings (same
    // parent, same kind) that haven't moved yet are where the market may
    // cycle next.
    const flaggedKeys = new Set(spiking.filter(i => i.flagged).map(i => i.segment));
    const catchUp = spiking
      .filter(i => i.flagged && i.parentKey)
      .slice(0, 10)
      .map(i => ({
        of: { segment: i.segment, label: i.label },
        items: items
          .filter(
            s =>
              s.parentKey === i.parentKey &&
              s.scope === i.scope &&
              s.segment !== i.segment &&
              !flaggedKeys.has(s.segment) &&
              (s.spikeScore ?? 0) < 25,
          )
          .sort((a, b) => (a.spikeScore ?? 0) - (b.spikeScore ?? 0) || (b.heat ?? 0) - (a.heat ?? 0))
          .slice(0, 5),
      }))
      .filter(g => g.items.length > 0);

    // Specific cards that lit up inside a tracked topic in the last 3 days
    // (their latest reading), plus same-card versions that haven't moved yet.
    const variants: VariantRow[] = await this.ds.query(
      `WITH hot AS (
         SELECT DISTINCT segment, signature FROM market_variant_points
          WHERE hot AND "capturedAt" >= $1
       )
       SELECT DISTINCT ON (v.segment, v.signature)
              v.segment, v.signature, v.label, v."capturedAt", v."listedCount", v."floorUsd",
              v."medianUsd", v."clearedCount", v."floorChangePct", v."countChangePct", v.hot, v.extra,
              t.label AS "topicLabel", t."rootMarket"
         FROM market_variant_points v
         JOIN hot USING (segment, signature)
         LEFT JOIN market_taxonomy t ON t.key = v.segment
        ORDER BY v.segment, v.signature, v."capturedAt" DESC`,
      [since72h],
    );
    const hotSegments = [...new Set(variants.map(v => v.segment))];
    const siblingsRaw: VariantRow[] = hotSegments.length
      ? await this.ds.query(
          `SELECT DISTINCT ON (segment, signature)
                  segment, signature, label, "capturedAt", "listedCount", "floorUsd", "medianUsd",
                  "clearedCount", "floorChangePct", "countChangePct", hot, extra
             FROM market_variant_points
            WHERE segment = ANY($1::text[]) AND "capturedAt" >= $2
            ORDER BY segment, signature, "capturedAt" DESC`,
          [hotSegments, since48h],
        )
      : [];
    const tracked = new Set<string>(
      ((await this.ds.query(`SELECT key FROM market_taxonomy WHERE key LIKE 'auto\\_%'`)) as { key: string }[]).map(
        r => r.key,
      ),
    );
    // Same card = same number; a different grade or parallel is a sibling.
    const cardNumber = (sig: string) => sig.split('|').find(p => /\d/.test(p) && !/^(19|20)\d\d$/.test(p)) ?? sig;
    const discoveries = variants
      .map(v => {
        const key = autoKey(v.segment, v.signature);
        return {
          segment: v.segment,
          topicLabel: v.topicLabel ?? v.segment,
          signature: v.signature,
          label: v.label,
          capturedAt: v.capturedAt,
          listedCount: v.listedCount,
          floorUsd: num(v.floorUsd),
          medianUsd: num(v.medianUsd),
          clearedCount: v.clearedCount,
          floorChangePct: num(v.floorChangePct),
          countChangePct: num(v.countChangePct),
          stillHot: v.hot,
          sampleUrl: (v.extra?.sampleUrl as string) ?? null,
          trackedKey: tracked.has(key) ? key : null,
          notYetMoved: siblingsRaw
            .filter(
              s =>
                s.segment === v.segment &&
                s.signature !== v.signature &&
                !s.hot &&
                cardNumber(s.signature) === cardNumber(v.signature),
            )
            .sort((a, b) => b.listedCount - a.listedCount)
            .slice(0, 4)
            .map(s => ({ signature: s.signature, label: s.label, listedCount: s.listedCount, floorUsd: num(s.floorUsd) })),
        };
      })
      .sort(
        (a, b) =>
          Number(b.stillHot) - Number(a.stillHot) ||
          (b.floorChangePct ?? 0) - (a.floorChangePct ?? 0) ||
          b.clearedCount - a.clearedCount,
      )
      .slice(0, 30);

    const latestByKey = new Map(items.map(i => [i.segment, i]));
    const watchRows: { key: string; label: string; kind: string; watchUntil: Date; watchReason: string | null }[] =
      await this.ds.query(
        `SELECT key, label, kind, "watchUntil", "watchReason" FROM market_taxonomy
          WHERE "watchUntil" > $1 AND active = true ORDER BY "watchUntil" DESC`,
        [now],
      );
    const watching = watchRows.map(w => ({
      segment: w.key,
      label: w.label,
      kind: w.kind,
      watchUntil: w.watchUntil,
      watchReason: w.watchReason,
      spikeScore: latestByKey.get(w.key)?.spikeScore ?? null,
      lastSnapshotAt: latestByKey.get(w.key)?.capturedAt ?? null,
    }));

    const [{ n: snapshots24h }] = await this.ds.query(
      `SELECT COUNT(*)::int AS n FROM market_heat_points WHERE "capturedAt" >= $1`,
      [new Date(now.getTime() - 24 * 3600_000)],
    );

    return {
      asOf: now.toISOString(),
      spiking,
      catchUp,
      discoveries,
      watching,
      budget: { snapshots24h, watchCap: WATCH_CAP, watching: watching.length },
    };
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
    await this.ds.query(`DELETE FROM market_variant_points WHERE segment = $1`, [key]);
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
  async latest(scope?: string, market?: string): Promise<Record<string, unknown>[]> {
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
    // peakHeat = this topic's own all-time high, scoredReadings = how many scored
    // snapshots back it (windows run before DISTINCT ON).
    const rows: Record<string, unknown>[] = await this.ds.query(
      `SELECT DISTINCT ON (h.segment) h.*,
              MAX(h."heatScore") OVER (PARTITION BY h.segment) AS "peakHeat",
              COUNT(h."heatScore") OVER (PARTITION BY h.segment)::int AS "scoredReadings",
              t."rootMarket", t.kind AS "taxKind", t."parentKey",
              t."watchUntil", t."watchReason"
         FROM market_heat_points h
         LEFT JOIN market_taxonomy t ON t.key = h.segment
         ${where}
         ORDER BY h.segment, h."capturedAt" DESC`,
      params,
    );
    // Sub-scores behind each heat score, recomputed from the stored inputs.
    return rows.map(r => ({ ...r, heatDrivers: pointHeatDrivers(r) }));
  }

  /**
   * The site-wide record scale (see HeatScale): the hottest and coldest raw
   * readings ever stored, across every topic and scope. Ties go to whichever
   * reading got there first. Null until at least one scored snapshot exists.
   */
  async scale(): Promise<HeatScale | null> {
    const rows: Array<{
      kind: 'high' | 'low';
      segment: string;
      label: string | null;
      score: number;
      capturedAt: string;
      readings: number;
    }> = await this.ds.query(
      `(SELECT 'high' AS kind, segment, label, "heatScore" AS score, "capturedAt",
               COUNT(*) OVER ()::int AS readings
          FROM market_heat_points WHERE "heatScore" IS NOT NULL
         ORDER BY "heatScore" DESC, "capturedAt" ASC LIMIT 1)
       UNION ALL
       (SELECT 'low' AS kind, segment, label, "heatScore" AS score, "capturedAt",
               COUNT(*) OVER ()::int AS readings
          FROM market_heat_points WHERE "heatScore" IS NOT NULL
         ORDER BY "heatScore" ASC, "capturedAt" ASC LIMIT 1)`,
    );
    const pick = (k: 'high' | 'low'): HeatRecord | null => {
      const r = rows.find(x => x.kind === k);
      return r ? { score: r.score, segment: r.segment, label: r.label, capturedAt: r.capturedAt } : null;
    };
    const high = pick('high');
    const low = pick('low');
    if (!high || !low) return null;
    return {
      ceiling: high.score,
      floor: Math.min(low.score, high.score - MIN_SCALE_SPAN),
      high,
      low,
      readings: rows[0].readings,
    };
  }

  /**
   * Biggest heat movers — topics whose heat score changed most vs. ~a day
   * earlier (the latest scored snapshot at least BASELINE_MIN_AGE_HOURS older,
   * so hourly watch-mode snapshots don't shrink "movers" to hour-over-hour).
   * Needs a day of history per topic.
   */
  movers(scope?: string, limit = 12): Promise<unknown[]> {
    const filtered = scope && scope !== 'all';
    const lim = Math.max(1, Math.min(limit, 50));
    return this.ds.query(
      `WITH cur AS (
         SELECT DISTINCT ON (segment) segment, label, scope, "heatScore", "totalActive",
                "totalActiveChangePct", "askChangePct", "clearedRatePct", "capturedAt"
           FROM market_heat_points
          ${filtered ? 'WHERE scope = $1' : ''}
          ORDER BY segment, "capturedAt" DESC
       )
       SELECT cur.segment, cur.label, cur.scope, cur."heatScore" AS heat,
              (cur."heatScore" - prev."heatScore") AS "heatChange",
              cur."totalActive", cur."totalActiveChangePct", cur."askChangePct",
              cur."clearedRatePct", cur."capturedAt"
         FROM cur
         JOIN LATERAL (
           SELECT p."heatScore" FROM market_heat_points p
            WHERE p.segment = cur.segment AND p."heatScore" IS NOT NULL
              AND p."capturedAt" <= cur."capturedAt" - interval '${BASELINE_MIN_AGE_HOURS} hours'
            ORDER BY p."capturedAt" DESC LIMIT 1
         ) prev ON true
        WHERE cur."heatScore" IS NOT NULL
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
    const [latest, movers, scale] = await Promise.all([
      this.latest(scope),
      this.movers(scope, 20),
      this.scale(),
    ]);
    // `heat` / `heatChange` are on the record-scale index (what the board shows);
    // the notable threshold stays on raw points so alerting doesn't drift as records move.
    const pick = (r: Record<string, unknown>) => ({
      market: r.label || r.segment,
      scope: r.scope,
      heat: toHeatIndex(r.heatScore as number | null, scale),
      totalActive: r.totalActive,
      askChangePct: r.askChangePct,
      supplyChangePct: r.totalActiveChangePct,
    });
    const rows = latest
      .filter(r => r.heatScore != null)
      .sort((a, b) => (b.heatScore as number) - (a.heatScore as number));
    const hottest = rows.slice(0, 3).map(pick);
    const coolest = rows.slice(-3).reverse().map(pick);
    const mv = (movers as Record<string, unknown>[]).map(m => ({
      market: m.label || m.segment,
      heatChange: toHeatIndexDelta(m.heatChange as number | null, scale),
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
      // One reading per day (the day's last) — hourly watch-mode snapshots
      // would otherwise inflate the point count and the confidence tier.
      `SELECT DISTINCT ON (h.segment, h."capturedAt"::date)
              h.segment, h.scope, h.label, h."capturedAt", h."heatScore", h."medianAskUsd",
              t."rootMarket", t.kind AS "taxKind"
         FROM market_heat_points h
         LEFT JOIN market_taxonomy t ON t.key = h.segment
        WHERE ${conds.join(' AND ')}
        ORDER BY h.segment, h."capturedAt"::date ASC, h."capturedAt" DESC`,
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
