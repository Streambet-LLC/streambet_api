import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import {
  AnalyticsAssetCategory,
  AnalyticsProfileAnnotations,
  AnalyticsProfileSocialEntry,
  AnalyticsSocialPlatform,
  CollectorAnalyticsOverviewDto,
  CollectorOrderEventDto,
  CollectorOverviewCategoryDto,
  CollectorProfileDetailDto,
  CollectorProfileSummaryDto,
  CollectorSocialDto,
  UpdateCollectorAnalyticsProfileDto,
  UpdateCollectorSocialsDto,
} from './dto/collector-analytics.dto';

/**
 * Statuses we treat as a "real" paid transaction for analytics. Excludes
 * pending / failed / cancelled to keep revenue numbers honest.
 */
const PAID_STATUSES = ['paid', 'shipped', 'delivered'] as const;
const PAID_STATUSES_SQL = "('paid','shipped','delivered')";

/**
 * Coerce a raw row's string/number/null amount into a finite number. SUM()
 * comes back as a string from pg, COUNT() comes back as a string too.
 */
const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/**
 * Map PrizeBrand → the four-bucket Analytics taxonomy. Unknown values fall
 * into `other` so the UI denominators stay consistent.
 */
const brandToCategory = (
  brand: string | null | undefined,
): AnalyticsAssetCategory => {
  switch (brand) {
    case 'pokemon':
      return 'pokemon';
    case 'one_piece':
      return 'one_piece';
    case 'sports':
      return 'sports';
    default:
      return 'other';
  }
};

const categoryLabel = (c: AnalyticsAssetCategory): string =>
  c === 'pokemon'
    ? 'Pokémon'
    : c === 'one_piece'
      ? 'One Piece'
      : c === 'sports'
        ? 'Sports'
        : 'Other';

/**
 * Normalize a raw social value (URL or @handle) into a `{ handle, url }`
 * pair the front-end can render. We don't try to be cute — if the seller
 * pasted a full URL we keep it; otherwise we build the canonical one.
 */
const buildSocial = (
  platform: AnalyticsSocialPlatform,
  raw: string,
): Omit<CollectorSocialDto, 'source'> | null => {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const isUrl = /^https?:\/\//i.test(value);
  let handle = value;
  if (isUrl) {
    try {
      const u = new URL(value);
      const last = u.pathname
        .replace(/\/$/, '')
        .split('/')
        .filter(Boolean)
        .pop();
      handle = (last ?? value).replace(/^@/, '');
    } catch {
      handle = value;
    }
  } else {
    handle = handle.replace(/^@/, '');
  }

  const url = (() => {
    if (isUrl) return value;
    const h = handle.replace(/^@/, '');
    switch (platform) {
      case 'instagram':
        return `https://instagram.com/${h}`;
      case 'twitter':
        return `https://twitter.com/${h}`;
      case 'tiktok':
        return `https://tiktok.com/@${h}`;
      case 'youtube':
        return `https://youtube.com/@${h}`;
      case 'facebook':
        return `https://facebook.com/${h}`;
      case 'twitch':
        return `https://twitch.tv/${h}`;
      case 'ebay':
        return `https://www.ebay.com/usr/${h}`;
      default:
        return value;
    }
  })();

  return { platform, handle, url };
};

const SUPPORTED_SOCIAL_KEYS: AnalyticsSocialPlatform[] = [
  'instagram',
  'twitter',
  'tiktok',
  'youtube',
  'facebook',
  'twitch',
  'ebay',
];

const extractSocials = (
  socials: Record<string, string> | null | undefined,
): CollectorSocialDto[] => {
  if (!socials) return [];
  const out: CollectorSocialDto[] = [];
  for (const key of SUPPORTED_SOCIAL_KEYS) {
    const raw = socials[key];
    if (typeof raw === 'string') {
      const s = buildSocial(key, raw);
      if (s) out.push({ ...s, source: 'public' });
    }
  }
  return out;
};

/**
 * Expand `analytics_profile.socials` (an array of admin-curated entries
 * that allows multiple rows per platform) into the wire-level
 * `CollectorSocialDto` shape, tagging each row as `source: 'analytics'`.
 */
const extractAnalyticsSocials = (
  entries: AnalyticsProfileSocialEntry[] | undefined,
): CollectorSocialDto[] => {
  if (!entries || entries.length === 0) return [];
  const out: CollectorSocialDto[] = [];
  for (const entry of entries) {
    const built = buildSocial(entry.platform, entry.value);
    if (!built) continue;
    out.push({
      ...built,
      id: entry.id,
      label: entry.label,
      source: 'analytics',
    });
  }
  return out;
};

/** Generate a stable id for a new analytics social entry. */
const makeSocialEntryId = (): string =>
  `as_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Merge public + analytics socials, dropping analytics rows whose
 * (platform, handle) pair already exists on the public side. Without
 * this, collectors that had analytics rows written before the dialog
 * was fixed render duplicate entries (each public handle showed up
 * again from the analytics list).
 *
 * Public entries always win the keep-vs-drop coin flip because they're
 * the canonical source the user themselves controls.
 */
const mergeSocialsForDetail = (
  publicEntries: CollectorSocialDto[],
  analyticsEntries: CollectorSocialDto[],
): CollectorSocialDto[] => {
  const seen = new Set<string>();
  const out: CollectorSocialDto[] = [];
  const keyOf = (s: CollectorSocialDto) =>
    `${s.platform}|${(s.handle ?? '').toLowerCase()}`;
  for (const s of publicEntries) {
    const k = keyOf(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  for (const s of analyticsEntries) {
    const k = keyOf(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
};

/**
 * Coerce whatever sits in `analytics_profile.socials` into a clean list of
 * entries. Drops blanks, enforces the supported-platform allowlist, caps
 * size, and backfills stable ids for legacy rows that don’t have one yet.
 */
const sanitizeSocialEntries = (raw: unknown): AnalyticsProfileSocialEntry[] => {
  if (!Array.isArray(raw)) return [];
  const supported = new Set<string>(SUPPORTED_SOCIAL_KEYS);
  const out: AnalyticsProfileSocialEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const platform =
      typeof obj.platform === 'string' ? obj.platform.trim() : '';
    if (!supported.has(platform)) continue;
    const value = typeof obj.value === 'string' ? obj.value.trim() : '';
    if (!value) continue;
    const normalized = /^https?:\/\//i.test(value)
      ? value
      : value.replace(/^@+/, '');
    const id =
      typeof obj.id === 'string' && obj.id.trim().length > 0
        ? obj.id.trim().slice(0, 64)
        : makeSocialEntryId();
    const labelRaw = typeof obj.label === 'string' ? obj.label.trim() : '';
    out.push({
      id,
      platform: platform as AnalyticsSocialPlatform,
      value: normalized,
      ...(labelRaw && { label: labelRaw.slice(0, 64) }),
    });
    if (out.length >= 64) break;
  }
  return out;
};

/**
 * Coerce whatever sits in `users.analytics_profile` jsonb into the
 * documented annotation shape. Drops unknown keys and empty / blank
 * values so the column stays tidy and predictable for consumers.
 */
const sanitizeAnnotations = (
  raw: unknown,
): AnalyticsProfileAnnotations | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: AnalyticsProfileAnnotations = {};

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;

  const strArr = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const arr = v
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x.length > 0);
    return arr.length > 0 ? arr.slice(0, 40) : undefined;
  };

  const kv = (v: unknown): Record<string, string> | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(
        ([k, val]) =>
          typeof k === 'string' &&
          k.trim().length > 0 &&
          typeof val === 'string' &&
          val.trim().length > 0,
      )
      .slice(0, 50)
      .map(([k, val]) => [k.trim(), (val as string).trim()] as const);
    return entries.length ? Object.fromEntries(entries) : undefined;
  };

  const displayName = str(r.displayName);
  if (displayName) out.displayName = displayName;
  const bio = str(r.bio);
  if (bio) out.bio = bio;
  const personaOverride = str(r.personaOverride);
  if (personaOverride) out.personaOverride = personaOverride;
  const interests = strArr(r.interests);
  if (interests) out.interests = interests;
  const preferences = strArr(r.preferences);
  if (preferences) out.preferences = preferences;
  const customAttributes = kv(r.customAttributes);
  if (customAttributes) out.customAttributes = customAttributes;
  const notes = str(r.notes);
  if (notes) out.notes = notes;
  const socials = sanitizeSocialEntries(r.socials);
  if (socials.length > 0) out.socials = socials;
  const lastEditedAt = str(r.lastEditedAt);
  if (lastEditedAt) out.lastEditedAt = lastEditedAt;
  const lastEditedBy = str(r.lastEditedBy);
  if (lastEditedBy) out.lastEditedBy = lastEditedBy;

  return Object.keys(out).length > 0 ? out : null;
};

/**
 * Service that powers the admin "collector analytics" surface using only
 * data we own: `users.socials`, `prize_orders` (buy side), and
 * `prize_configurations` joined back to their creator (sell side). All
 * inferred / scraped fields the demo dashboard shows (personas,
 * predictions, scraper pipelines) remain mocked on the front-end for now.
 */
@Injectable()
export class CollectorAnalyticsService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(PrizeOrder)
    private readonly prizeOrderRepository: Repository<PrizeOrder>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Thin typed wrapper around `dataSource.query` — TypeORM declares it as
   * `Promise<any>` which trips every unsafe-any lint rule in this file.
   * Every call-site passes the expected row shape as `T`.
   */
  private async rawQuery<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const rows: unknown = await this.dataSource.query(sql, params);
    return (rows ?? []) as T[];
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  async getOverview(): Promise<CollectorAnalyticsOverviewDto> {
    const now = new Date();
    const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // -- Totals -------------------------------------------------------------
    const totalProfiles = await this.userRepository.count({
      where: { isActive: true },
    });

    const [activeBuyersRow] = await this.rawQuery<{ c: number | string }>(
      `SELECT COUNT(DISTINCT o.user_id)::int AS c
       FROM prize_orders o
       WHERE o.status IN ${PAID_STATUSES_SQL}
         AND o."createdAt" >= $1`,
      [cutoff30d],
    );
    const activeBuyers30d = num(activeBuyersRow?.c);

    const [activeSellersRow] = await this.rawQuery<{ c: number | string }>(
      `SELECT COUNT(DISTINCT p.created_by)::int AS c
       FROM prize_orders o
       JOIN prize_configurations p ON p.id = o.prize_configuration_id
       WHERE o.status IN ${PAID_STATUSES_SQL}
         AND o."createdAt" >= $1
         AND p.created_by IS NOT NULL`,
      [cutoff30d],
    );
    const activeSellers30d = num(activeSellersRow?.c);

    const [spend30dRow] = await this.rawQuery<{ s: number | string }>(
      `SELECT COALESCE(SUM(o.total_price), 0)::float AS s
       FROM prize_orders o
       WHERE o.status IN ${PAID_STATUSES_SQL}
         AND o."createdAt" >= $1`,
      [cutoff30d],
    );
    const spend30dUsd = num(spend30dRow?.s);

    const [lifetimeRow] = await this.rawQuery<{ s: number | string }>(
      `SELECT COALESCE(SUM(o.total_price), 0)::float AS s
       FROM prize_orders o
       WHERE o.status IN ${PAID_STATUSES_SQL}`,
    );
    const lifetimeSpendUsd = num(lifetimeRow?.s);

    // -- Category affinity (last 30d) --------------------------------------
    const categoryRows = await this.rawQuery<{
      brand: string | null;
      spend: number | string;
      buyers: number | string;
    }>(
      `SELECT p.brand AS brand,
              COALESCE(SUM(o.total_price), 0)::float AS spend,
              COUNT(DISTINCT o.user_id)::int AS buyers
       FROM prize_orders o
       JOIN prize_configurations p ON p.id = o.prize_configuration_id
       WHERE o.status IN ${PAID_STATUSES_SQL}
         AND o."createdAt" >= $1
       GROUP BY p.brand`,
      [cutoff30d],
    );

    const categoryAffinityMap = new Map<
      AnalyticsAssetCategory,
      CollectorOverviewCategoryDto
    >();
    for (const c of ['pokemon', 'one_piece', 'sports', 'other'] as const) {
      categoryAffinityMap.set(c, {
        category: c,
        label: categoryLabel(c),
        spendUsd: 0,
        userCount: 0,
      });
    }
    for (const row of categoryRows) {
      const cat = brandToCategory(row.brand);
      const entry = categoryAffinityMap.get(cat);
      if (!entry) continue;
      entry.spendUsd += num(row.spend);
      entry.userCount += num(row.buyers);
    }
    const categoryAffinity = Array.from(categoryAffinityMap.values()).sort(
      (a, b) => b.spendUsd - a.spendUsd,
    );

    // -- Top assets (last 30d) ---------------------------------------------
    const topAssetRows = await this.rawQuery<{
      asset_id: string;
      name: string;
      brand: string | null;
      buyers: number | string;
      units: number | string;
      revenue: number | string;
    }>(
      `SELECT p.id AS asset_id,
              p.name AS name,
              p.brand AS brand,
              COUNT(DISTINCT o.user_id)::int AS buyers,
              COUNT(o.id)::int AS units,
              COALESCE(SUM(o.total_price), 0)::float AS revenue
       FROM prize_orders o
       JOIN prize_configurations p ON p.id = o.prize_configuration_id
       WHERE o.status IN ${PAID_STATUSES_SQL}
         AND o."createdAt" >= $1
       GROUP BY p.id, p.name, p.brand
       ORDER BY revenue DESC
       LIMIT 8`,
      [cutoff30d],
    );
    const topAssets = topAssetRows.map((r) => ({
      assetId: r.asset_id,
      name: r.name,
      category: brandToCategory(r.brand),
      buyers: num(r.buyers),
      unitsSold: num(r.units),
      revenueUsd: num(r.revenue),
    }));

    // -- Spend trend (last 12 weeks) ---------------------------------------
    const cutoff12w = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
    const trendRows = await this.rawQuery<{
      week_start: Date | string;
      spend: number | string;
      buyers: number | string;
    }>(
      `SELECT date_trunc('week', o."createdAt") AS week_start,
              COALESCE(SUM(o.total_price), 0)::float AS spend,
              COUNT(DISTINCT o.user_id)::int AS buyers
       FROM prize_orders o
       WHERE o.status IN ${PAID_STATUSES_SQL}
         AND o."createdAt" >= $1
       GROUP BY week_start
       ORDER BY week_start ASC`,
      [cutoff12w],
    );
    // Densify into a continuous 12-week window so charts don't have gaps.
    const trendMap = new Map<string, { spend: number; buyers: number }>();
    for (const r of trendRows) {
      trendMap.set(new Date(r.week_start).toISOString(), {
        spend: num(r.spend),
        buyers: num(r.buyers),
      });
    }
    const spendTrend = [] as CollectorAnalyticsOverviewDto['spendTrend'];
    // Anchor at the start of the current ISO week (Monday, UTC) so labels
    // line up with how the SQL bucketing rounds.
    const anchor = new Date(now);
    anchor.setUTCHours(0, 0, 0, 0);
    const dow = anchor.getUTCDay(); // 0..6, 0 = Sun
    const daysSinceMonday = (dow + 6) % 7;
    anchor.setUTCDate(anchor.getUTCDate() - daysSinceMonday);
    for (let i = 11; i >= 0; i--) {
      const ws = new Date(anchor);
      ws.setUTCDate(anchor.getUTCDate() - i * 7);
      const key = ws.toISOString();
      const hit = trendMap.get(key);
      spendTrend.push({
        weekStart: key,
        label: `W${12 - i}`,
        spendUsd: hit ? hit.spend : 0,
        buyers: hit ? hit.buyers : 0,
      });
    }

    return {
      totalProfiles,
      activeBuyers30d,
      activeSellers30d,
      spend30dUsd,
      lifetimeSpendUsd,
      categoryAffinity,
      topAssets,
      spendTrend,
    };
  }

  // ---------------------------------------------------------------------------
  // Profile list
  // ---------------------------------------------------------------------------

  async listProfiles(opts: {
    limit?: number;
    offset?: number;
    search?: string;
    onlySellers?: boolean;
  }): Promise<{ total: number; data: CollectorProfileSummaryDto[] }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const search = (opts.search ?? '').trim().toLowerCase();
    const onlySellers = !!opts.onlySellers;
    const now = new Date();
    const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // First we resolve the page of users so subsequent aggregates only need
    // to scan a bounded set. Sort by `createdAt` desc so newest profiles
    // land first by default.
    const qb = this.userRepository
      .createQueryBuilder('u')
      .where('u.deletedAt IS NULL')
      .andWhere('u.isActive = true');

    if (onlySellers) {
      qb.andWhere('u.isSeller = true');
    }
    if (search) {
      qb.andWhere(
        "(LOWER(u.username) LIKE :q OR LOWER(u.email) LIKE :q OR LOWER(COALESCE(u.name, '')) LIKE :q)",
        { q: `%${search}%` },
      );
    }

    const total = await qb.clone().getCount();
    const users = await qb
      .orderBy('u.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getMany();

    if (users.length === 0) {
      return { total, data: [] };
    }

    const userIds = users.map((u) => u.id);

    // Buy-side aggregates per user.
    const buyAggRows = await this.rawQuery<{
      user_id: string;
      lifetime: number | string;
      last_30d: number | string;
      purchases: number | string;
      last_purchase: Date | string | null;
    }>(
      `SELECT o.user_id AS user_id,
              COALESCE(SUM(o.total_price), 0)::float AS lifetime,
              COALESCE(SUM(CASE WHEN o."createdAt" >= $2 THEN o.total_price ELSE 0 END), 0)::float AS last_30d,
              COUNT(*)::int AS purchases,
              MAX(o."createdAt") AS last_purchase
       FROM prize_orders o
       WHERE o.user_id = ANY($1::uuid[])
         AND o.status IN ${PAID_STATUSES_SQL}
       GROUP BY o.user_id`,
      [userIds, cutoff30d],
    );
    const buyAgg = new Map<
      string,
      {
        lifetime: number;
        last30d: number;
        purchases: number;
        lastPurchase: Date | null;
      }
    >();
    for (const r of buyAggRows) {
      buyAgg.set(r.user_id, {
        lifetime: num(r.lifetime),
        last30d: num(r.last_30d),
        purchases: num(r.purchases),
        lastPurchase: r.last_purchase ? new Date(r.last_purchase) : null,
      });
    }

    // Sell-side aggregates per user (seller side).
    const sellAggRows = await this.rawQuery<{
      user_id: string;
      revenue: number | string;
      sales: number | string;
    }>(
      `SELECT p.created_by AS user_id,
              COALESCE(SUM(o.total_price), 0)::float AS revenue,
              COUNT(*)::int AS sales
       FROM prize_orders o
       JOIN prize_configurations p ON p.id = o.prize_configuration_id
       WHERE p.created_by = ANY($1::uuid[])
         AND o.status IN ${PAID_STATUSES_SQL}
       GROUP BY p.created_by`,
      [userIds],
    );
    const sellAgg = new Map<string, { revenue: number; sales: number }>();
    for (const r of sellAggRows) {
      sellAgg.set(r.user_id, {
        revenue: num(r.revenue),
        sales: num(r.sales),
      });
    }

    // Category mix per user (buy-side) — used to derive `topCategories`.
    const catRows = await this.rawQuery<{
      user_id: string;
      brand: string | null;
      spend: number | string;
    }>(
      `SELECT o.user_id AS user_id,
              p.brand AS brand,
              COALESCE(SUM(o.total_price), 0)::float AS spend
       FROM prize_orders o
       JOIN prize_configurations p ON p.id = o.prize_configuration_id
       WHERE o.user_id = ANY($1::uuid[])
         AND o.status IN ${PAID_STATUSES_SQL}
       GROUP BY o.user_id, p.brand`,
      [userIds],
    );
    const catAgg = new Map<string, Map<AnalyticsAssetCategory, number>>();
    for (const r of catRows) {
      let m = catAgg.get(r.user_id);
      if (!m) {
        m = new Map();
        catAgg.set(r.user_id, m);
      }
      const cat = brandToCategory(r.brand);
      m.set(cat, (m.get(cat) ?? 0) + num(r.spend));
    }

    const data: CollectorProfileSummaryDto[] = users.map((u) => {
      const buy = buyAgg.get(u.id);
      const sell = sellAgg.get(u.id);
      const cats = catAgg.get(u.id);
      const topCategories = cats
        ? Array.from(cats.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([c]) => c)
        : [];
      return {
        id: u.id,
        username: u.username,
        displayName: u.name || u.username,
        email: u.email,
        joinedAt: (u.accountCreationDate ?? u.createdAt).toISOString(),
        isSeller: !!u.isSeller,
        lifetimeSpendUsd: Math.round((buy?.lifetime ?? 0) * 100) / 100,
        last30dSpendUsd: Math.round((buy?.last30d ?? 0) * 100) / 100,
        purchaseCount: buy?.purchases ?? 0,
        saleCount: sell?.sales ?? 0,
        lifetimeSalesUsd: Math.round((sell?.revenue ?? 0) * 100) / 100,
        lastPurchaseAt: buy?.lastPurchase
          ? buy.lastPurchase.toISOString()
          : null,
        topCategories,
        socials: extractSocials(u.socials),
      };
    });

    return { total, data };
  }

  // ---------------------------------------------------------------------------
  // Profile detail
  // ---------------------------------------------------------------------------

  async getProfileDetail(userId: string): Promise<CollectorProfileDetailDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Buy-side rollup (reusing the same query shape as listProfiles, scoped
    // to a single user).
    const [buyRow] = await this.rawQuery<{
      lifetime: number | string;
      last_30d: number | string;
      purchases: number | string;
      last_purchase: Date | string | null;
    }>(
      `SELECT COALESCE(SUM(o.total_price), 0)::float AS lifetime,
              COALESCE(SUM(CASE WHEN o."createdAt" >= $2 THEN o.total_price ELSE 0 END), 0)::float AS last_30d,
              COUNT(*)::int AS purchases,
              MAX(o."createdAt") AS last_purchase
       FROM prize_orders o
       WHERE o.user_id = $1
         AND o.status IN ${PAID_STATUSES_SQL}`,
      [userId, cutoff30d],
    );

    const [sellRow] = await this.rawQuery<{
      revenue: number | string;
      sales: number | string;
    }>(
      `SELECT COALESCE(SUM(o.total_price), 0)::float AS revenue,
              COUNT(*)::int AS sales
       FROM prize_orders o
       JOIN prize_configurations p ON p.id = o.prize_configuration_id
       WHERE p.created_by = $1
         AND o.status IN ${PAID_STATUSES_SQL}`,
      [userId],
    );

    // Per-category breakdown across the buyer's lifetime so the detail
    // page can render a richer per-collector profile.
    const catRows = await this.rawQuery<{
      brand: string | null;
      spend: number | string;
      orders: number | string;
    }>(
      `SELECT p.brand AS brand,
              COALESCE(SUM(o.total_price), 0)::float AS spend,
              COUNT(*)::int AS orders
       FROM prize_orders o
       JOIN prize_configurations p ON p.id = o.prize_configuration_id
       WHERE o.user_id = $1
         AND o.status IN ${PAID_STATUSES_SQL}
       GROUP BY p.brand`,
      [userId],
    );
    const categoryBreakdownMap = new Map<
      AnalyticsAssetCategory,
      { spendUsd: number; orderCount: number }
    >();
    for (const c of ['pokemon', 'one_piece', 'sports', 'other'] as const) {
      categoryBreakdownMap.set(c, { spendUsd: 0, orderCount: 0 });
    }
    for (const r of catRows) {
      const cat = brandToCategory(r.brand);
      const e = categoryBreakdownMap.get(cat);
      if (!e) continue;
      e.spendUsd += num(r.spend);
      e.orderCount += num(r.orders);
    }
    const categoryBreakdown = Array.from(categoryBreakdownMap.entries())
      .map(([category, v]) => ({
        category,
        spendUsd: Math.round(v.spendUsd * 100) / 100,
        orderCount: v.orderCount,
      }))
      .sort((a, b) => b.spendUsd - a.spendUsd);

    const topCategories = categoryBreakdown
      .filter((c) => c.spendUsd > 0)
      .slice(0, 3)
      .map((c) => c.category);

    // Recent activity = last N purchases (buyer side) + last N sales
    // (seller side), interleaved by date.
    const RECENT_LIMIT = 25;
    type OrderRow = {
      id: string;
      at: Date | string;
      prize_name: string;
      brand: string | null;
      amount: number | string;
      payment_method: 'coins' | 'usd' | 'combined' | 'crypto';
      stripe_payment_method: 'card' | 'us_bank_account' | null;
      status: string;
      counterparty: string | null;
    };

    const purchaseRows = await this.rawQuery<OrderRow>(
      `SELECT o.id AS id,
              o."createdAt" AS at,
              p.name AS prize_name,
              p.brand AS brand,
              o.total_price::float AS amount,
              o.payment_method AS payment_method,
              o.stripe_payment_method AS stripe_payment_method,
              o.status AS status,
              seller.username AS counterparty
       FROM prize_orders o
       JOIN prize_configurations p ON p.id = o.prize_configuration_id
       LEFT JOIN users seller ON seller.id = p.created_by
       WHERE o.user_id = $1
         AND o.status IN ${PAID_STATUSES_SQL}
       ORDER BY o."createdAt" DESC
       LIMIT $2`,
      [userId, RECENT_LIMIT],
    );
    const saleRows = await this.rawQuery<OrderRow>(
      `SELECT o.id AS id,
              o."createdAt" AS at,
              p.name AS prize_name,
              p.brand AS brand,
              o.total_price::float AS amount,
              o.payment_method AS payment_method,
              o.stripe_payment_method AS stripe_payment_method,
              o.status AS status,
              buyer.username AS counterparty
       FROM prize_orders o
       JOIN prize_configurations p ON p.id = o.prize_configuration_id
       LEFT JOIN users buyer ON buyer.id = o.user_id
       WHERE p.created_by = $1
         AND o.status IN ${PAID_STATUSES_SQL}
       ORDER BY o."createdAt" DESC
       LIMIT $2`,
      [userId, RECENT_LIMIT],
    );

    const mapOrderRow = (
      r: OrderRow,
      kind: 'purchase' | 'sale',
    ): CollectorOrderEventDto => ({
      id: r.id,
      kind,
      at: new Date(r.at).toISOString(),
      prizeName: r.prize_name,
      category: brandToCategory(r.brand),
      amountUsd: num(r.amount),
      paymentMethod: r.payment_method,
      stripePaymentMethod: r.stripe_payment_method ?? null,
      status: r.status,
      counterpartyUsername: r.counterparty,
    });

    const recentOrders: CollectorOrderEventDto[] = [
      ...purchaseRows.map((r) => mapOrderRow(r, 'purchase')),
      ...saleRows.map((r) => mapOrderRow(r, 'sale')),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, RECENT_LIMIT);

    const annotations = sanitizeAnnotations(user.analyticsProfile);

    return {
      id: user.id,
      username: user.username,
      displayName: user.name || user.username,
      email: user.email,
      joinedAt: (user.accountCreationDate ?? user.createdAt).toISOString(),
      isSeller: !!user.isSeller,
      lifetimeSpendUsd: Math.round(num(buyRow?.lifetime) * 100) / 100,
      last30dSpendUsd: Math.round(num(buyRow?.last_30d) * 100) / 100,
      purchaseCount: num(buyRow?.purchases),
      saleCount: num(sellRow?.sales),
      lifetimeSalesUsd: Math.round(num(sellRow?.revenue) * 100) / 100,
      lastPurchaseAt: buyRow?.last_purchase
        ? new Date(buyRow.last_purchase).toISOString()
        : null,
      topCategories,
      socials: mergeSocialsForDetail(
        extractSocials(user.socials),
        extractAnalyticsSocials(annotations?.socials),
      ),
      categoryBreakdown,
      recentOrders,
      analyticsProfile: annotations,
    };
  }

  // ---------------------------------------------------------------------------
  // Admin writes — socials + analytics annotations
  // ---------------------------------------------------------------------------

  /**
   * Persist the analytics-side social list (multiple entries per platform
   * allowed) on `analytics_profile.socials`. When `applyToPublic` is true
   * the canonical public map (`users.socials`, surfaced on the user's
   * profile + shop) is **also** overwritten with the first entry per
   * platform; otherwise it is left intact and analytics edits stay admin-
   * only. Returns the full merged social list for the analytics UI.
   */
  async updateSocials(
    userId: string,
    dto: UpdateCollectorSocialsDto,
    editorId?: string,
  ): Promise<{
    socials: CollectorSocialDto[];
    appliedToPublic: boolean;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Build the new analytics-side list, preserving caller-supplied ids
    // where present so the UI can stable-key rows across edits.
    const cleanedEntries: AnalyticsProfileSocialEntry[] = [];
    for (const entry of dto.entries ?? []) {
      const value = (entry.value ?? '').trim();
      if (!value) continue;
      const normalized = /^https?:\/\//i.test(value)
        ? value
        : value.replace(/^@+/, '');
      cleanedEntries.push({
        id: entry.id?.trim() || makeSocialEntryId(),
        platform: entry.platform,
        value: normalized,
        ...(entry.label?.trim() && {
          label: entry.label.trim().slice(0, 64),
        }),
      });
      if (cleanedEntries.length >= 64) break;
    }

    const prevAnnotations = sanitizeAnnotations(user.analyticsProfile) ?? {};
    const nextAnnotations: AnalyticsProfileAnnotations = {
      ...prevAnnotations,
      socials: cleanedEntries,
      lastEditedAt: new Date().toISOString(),
      ...(editorId && { lastEditedBy: editorId }),
    };
    const cleanedAnnotations = sanitizeAnnotations(nextAnnotations);
    user.analyticsProfile = (cleanedAnnotations ?? null) as Record<
      string,
      unknown
    > | null;

    const applyToPublic = !!dto.applyToPublic;
    if (applyToPublic) {
      // Collapse to one-per-platform (first wins). Any platform not present
      // in the new list is removed from the public map so admins can fully
      // clear handles too.
      const publicMap: Record<string, string> = {};
      for (const entry of cleanedEntries) {
        if (!publicMap[entry.platform]) {
          publicMap[entry.platform] = entry.value;
        }
      }
      user.socials = publicMap;
    }

    await this.userRepository.save(user);

    return {
      socials: mergeSocialsForDetail(
        extractSocials(user.socials),
        extractAnalyticsSocials(cleanedAnnotations?.socials),
      ),
      appliedToPublic: applyToPublic,
    };
  }

  /**
   * Merge admin-supplied analytics annotations into
   * `users.analytics_profile`. Pass an empty payload to clear annotations.
   */
  async updateAnalyticsProfile(
    userId: string,
    dto: UpdateCollectorAnalyticsProfileDto,
    editorId?: string,
  ): Promise<{ analyticsProfile: AnalyticsProfileAnnotations | null }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const prev = sanitizeAnnotations(user.analyticsProfile) ?? {};

    // Whitelist supported keys. `undefined` leaves the existing value
    // intact; `null` / empty string clears it. Arrays / objects are
    // replaced wholesale.
    //
    // NOTE: `socials` is intentionally NOT mergeable here — it has its
    // own dedicated endpoint (`updateSocials`). Carrying it through this
    // path with a stale `prev` value is what caused the dialog to drop
    // newly-added rows when both mutations ran in parallel.
    const next: AnalyticsProfileAnnotations = {
      ...prev,
      ...(dto.displayName !== undefined && { displayName: dto.displayName }),
      ...(dto.bio !== undefined && { bio: dto.bio }),
      ...(dto.personaOverride !== undefined && {
        personaOverride: dto.personaOverride,
      }),
      ...(dto.interests !== undefined && { interests: dto.interests }),
      ...(dto.preferences !== undefined && {
        preferences: dto.preferences,
      }),
      ...(dto.customAttributes !== undefined && {
        customAttributes: dto.customAttributes,
      }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      lastEditedAt: new Date().toISOString(),
      ...(editorId && { lastEditedBy: editorId }),
    };

    // Drop empty / blank fields so the column doesn't accumulate noise.
    const cleaned = sanitizeAnnotations(next);
    user.analyticsProfile = (cleaned ?? null) as Record<string, unknown> | null;
    await this.userRepository.save(user);

    return { analyticsProfile: cleaned };
  }
}

// Re-export for convenience so tests can import the same constant.
export { PAID_STATUSES };
