import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { EbayBrowseSource } from './card-market/ebay-browse.source';
import { AcquisitionService } from './acquisition/acquisition.service';

export interface HeatTopic {
  key: string;
  scope: 'segment' | 'set' | 'card';
  label: string;
  /** eBay search that samples this market's active listings. */
  query: string;
  /** Keywords to attribute first-party tracked cards (empty = match all). */
  match: string[];
}

/**
 * The markets we snapshot: 6 broad segments + a curated list of hot sets and
 * marquee cards. Each is tracked through the identical pipeline; edit freely.
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

/** A social buzz probe (non-persisting) — supplied by the Nest layer. */
export type SocialBuzzFn = (
  query: string,
) => Promise<{ mentions: number | null; bySource: Record<string, number> }>;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
  if (comps.length === 0) return null;
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

/** Snapshot every segment (sequential — gentle on the eBay rate limit). */
export async function collectMarketHeat(
  ds: DataSource,
  ebay: EbayBrowseSource,
  opts?: { social?: SocialBuzzFn },
): Promise<CollectResult[]> {
  const out: CollectResult[] = [];
  for (const topic of HEAT_TOPICS) {
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

  /** Latest heat point per topic (for the "hottest markets" ranking). */
  latest(scope?: string): Promise<unknown[]> {
    const filtered = scope && scope !== 'all';
    return this.ds.query(
      `SELECT DISTINCT ON (segment) * FROM market_heat_points
         ${filtered ? 'WHERE scope = $1' : ''}
         ORDER BY segment, "capturedAt" DESC`,
      filtered ? [scope] : [],
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
    const topic = HEAT_TOPICS.find(t => t.key === marketKey);
    const kw = (topic?.match?.length ? topic.match : [topic?.label || marketKey])
      .filter(Boolean)
      .map(String);
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

    return { market: topic?.label || marketKey, keywords: kw, buyers, sellers, leads };
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
}
