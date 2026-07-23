import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ExternalSignal } from '../entities/external-signal.entity';
import { DiscoveredLead } from '../entities/discovered-lead.entity';
import { AnalyticsProfileSocialEntry } from '../dto/collector-analytics.dto';
import { AiService } from '../../integrations/ai/ai.service';
import {
  ConnectorUserContext,
  NormalizedSignal,
  SocialConnector,
} from './social-connector.interface';
import { ConsentedHandlesConnector } from './consented-handles.connector';
import {
  RedditService,
  RedditPost,
} from '../../integrations/reddit/reddit.service';
import { BlueskyService } from '../../integrations/bluesky/bluesky.service';
import {
  YoutubeService,
  YoutubeLead,
} from '../../integrations/youtube/youtube.service';
import {
  GoogleSearchService,
  GoogleSearchHit,
} from '../../integrations/google-search/google-search.service';
import {
  TwitchService,
  TwitchChannel,
} from '../../integrations/twitch/twitch.service';

export type DiscoverySource =
  | 'reddit'
  | 'bluesky'
  | 'youtube'
  | 'google'
  | 'twitch';

/** Source-agnostic discovery result row the UI renders for any platform. */
export interface DiscoveryLead {
  id: string;
  platform: DiscoverySource;
  author: string;
  authorDisplay: string | null;
  /** Community context (subreddit) when applicable. */
  community: string | null;
  title: string | null;
  text: string;
  url: string;
  upvotes: number | null;
  comments: number | null;
  reposts: number | null;
  /** Unix seconds. */
  createdAt: number;
}

/** Per-source display + prospect-attribute metadata for lead conversion. */
const SOURCE_META: Record<
  string,
  { label: string; prefix: string; key: string }
> = {
  reddit: { label: 'Reddit', prefix: 'u/', key: 'redditHandle' },
  bluesky: { label: 'Bluesky', prefix: '@', key: 'blueskyHandle' },
  youtube: { label: 'YouTube', prefix: '@', key: 'youtubeHandle' },
  twitch: { label: 'Twitch', prefix: '', key: 'twitchHandle' },
};

/**
 * Orchestrates the (compliant) external-signal connectors and persists their
 * output into `external_signals`. Today the only connector is consented
 * handles; eBay official-API and licensed-vendor connectors slot into the
 * same registry without touching consumers.
 *
 * Also owns the Discover engine: unified multi-source search whose results are
 * persisted into `discovered_leads` (deduped) to power the Leads dashboard.
 */
@Injectable()
export class AcquisitionService {
  private readonly logger = new Logger(AcquisitionService.name);
  private readonly connectors: SocialConnector[];

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ExternalSignal)
    private readonly signalRepo: Repository<ExternalSignal>,
    @InjectRepository(DiscoveredLead)
    private readonly leadRepo: Repository<DiscoveredLead>,
    consentedHandles: ConsentedHandlesConnector,
    private readonly reddit: RedditService,
    private readonly bluesky: BlueskyService,
    private readonly youtube: YoutubeService,
    private readonly googleSearch: GoogleSearchService,
    private readonly twitch: TwitchService,
    private readonly ai: AiService,
  ) {
    // Registry — append eBay / vendor connectors here as they land.
    this.connectors = [consentedHandles];
  }

  /**
   * Unified discovery across compliant search sources. Returns normalized
   * leads regardless of platform so the UI has one render path.
   *
   * `configured` is false when the chosen source is missing its credentials
   * (all sources except reddit-if-keyed need config now). An upstream failure
   * is caught and returned as `error` (with empty leads) — one source breaking
   * never fails the request or looks like an auth 403.
   */
  async discover(opts: {
    source: DiscoverySource;
    query: string;
    subreddit?: string;
    sort?: string;
    time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
    limit?: number;
  }): Promise<{
    configured: boolean;
    source: DiscoverySource;
    leads: DiscoveryLead[];
    error?: string;
  }> {
    const source = opts.source;

    // Dormant when the source's credentials aren't configured.
    const configured =
      source === 'bluesky'
        ? this.bluesky.isConfigured()
        : source === 'youtube'
          ? this.youtube.isConfigured()
          : source === 'google'
            ? this.googleSearch.isConfigured()
            : source === 'twitch'
              ? this.twitch.isConfigured()
              : this.reddit.isConfigured();
    if (!configured) return { configured: false, source, leads: [] };

    let leads: DiscoveryLead[] = [];
    try {
      if (source === 'bluesky') {
        const posts = await this.bluesky.searchPosts({
          query: opts.query,
          sort: opts.sort === 'latest' ? 'latest' : 'top',
          limit: opts.limit,
        });
        leads = posts.map((p) => this.fromBluesky(p));
      } else if (source === 'youtube') {
        const found = await this.youtube.searchCommenters({
          query: opts.query,
          limit: opts.limit,
        });
        leads = found.map((l) => this.fromYoutube(l));
      } else if (source === 'google') {
        const hits = await this.googleSearch.search({
          query: opts.query,
          limit: opts.limit,
        });
        leads = hits.map((h) => this.fromGoogle(h));
      } else if (source === 'twitch') {
        const channels = await this.twitch.searchChannels({
          query: opts.query,
          limit: opts.limit,
        });
        leads = channels.map((c) => this.fromTwitch(c));
      } else {
        const REDDIT_SORTS = ['relevance', 'new', 'top', 'comments'] as const;
        const posts = await this.reddit.searchPosts({
          query: opts.query,
          subreddit: opts.subreddit,
          sort: (REDDIT_SORTS as readonly string[]).includes(opts.sort ?? '')
            ? (opts.sort as (typeof REDDIT_SORTS)[number])
            : undefined,
          time: opts.time,
          limit: opts.limit,
        });
        leads = posts.map((p) => this.fromReddit(p));
      }
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response
        ?.status;
      const error = status
        ? `${source} API returned HTTP ${status} — check its credentials/config.`
        : e instanceof Error
          ? e.message
          : 'Search failed';
      this.logger.warn(`discover ${source} failed: ${error}`);
      return { configured: true, source, leads: [], error };
    }

    // Persist into the leads pool (best-effort — never fail the search).
    await this.persistLeads(source, opts.query, leads).catch((e) =>
      this.logger.warn(
        `persistLeads failed: ${e instanceof Error ? e.message : e}`,
      ),
    );

    return { configured: true, source, leads };
  }

  /** Upsert discovered leads into the pool, deduped by (source, externalId). */
  private async persistLeads(
    source: DiscoverySource,
    query: string,
    leads: DiscoveryLead[],
  ): Promise<void> {
    const now = new Date();
    for (const l of leads) {
      const postedAt = l.createdAt ? new Date(l.createdAt * 1000) : null;
      const existing = await this.leadRepo.findOne({
        where: { source, externalId: l.id },
      });
      if (existing) {
        existing.author = l.author.slice(0, 255);
        existing.authorDisplay = l.authorDisplay?.slice(0, 255) ?? null;
        existing.community = l.community?.slice(0, 255) ?? null;
        existing.title = l.title;
        existing.text = l.text ?? '';
        existing.url = l.url ?? null;
        existing.upvotes = l.upvotes;
        existing.comments = l.comments;
        existing.reposts = l.reposts;
        if (postedAt) existing.postedAt = postedAt;
        existing.lastSeenAt = now;
        await this.leadRepo.save(existing);
      } else {
        await this.leadRepo.save(
          this.leadRepo.create({
            source,
            externalId: l.id,
            author: l.author.slice(0, 255),
            authorDisplay: l.authorDisplay?.slice(0, 255) ?? null,
            community: l.community?.slice(0, 255) ?? null,
            title: l.title,
            text: l.text ?? '',
            url: l.url ?? null,
            upvotes: l.upvotes,
            comments: l.comments,
            reposts: l.reposts,
            postedAt,
            query: (query ?? '').slice(0, 512),
            status: 'new',
            lastSeenAt: now,
          }),
        );
      }
    }
  }

  /** Paginated leads pool with source / status / intent / text filters. */
  async listLeads(opts: {
    source?: string;
    status?: string;
    intent?: string;
    search?: string;
    sort?: 'recent' | 'score';
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; data: DiscoveredLead[]; unqualified: number }> {
    const qb = this.leadRepo.createQueryBuilder('l');
    if (opts.source && opts.source !== 'all') {
      qb.andWhere('l.source = :s', { s: opts.source });
    }
    if (opts.status && opts.status !== 'all') {
      qb.andWhere('l.status = :st', { st: opts.status });
    }
    if (opts.intent && opts.intent !== 'all') {
      qb.andWhere('l.intent = :it', { it: opts.intent });
    }
    if (opts.search?.trim()) {
      qb.andWhere(
        '(l.author ILIKE :q OR l.text ILIKE :q OR l.title ILIKE :q OR l.query ILIKE :q OR l.community ILIKE :q)',
        { q: `%${opts.search.trim()}%` },
      );
    }
    if (opts.sort === 'score') {
      qb.orderBy('l.buyerScore', 'DESC', 'NULLS LAST').addOrderBy(
        'l.createdAt',
        'DESC',
      );
    } else {
      qb.orderBy('l.createdAt', 'DESC');
    }
    const total = await qb.getCount();
    const data = await qb
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0)
      .getMany();
    // How many leads still need qualifying (drives the "Qualify (N)" button).
    const unqualified = await this.leadRepo
      .createQueryBuilder('l')
      .where('l.qualifiedAt IS NULL')
      .andWhere("l.status <> 'dismissed'")
      .getCount();
    return { total, data, unqualified };
  }

  /** Prevents a second Qualify click from double-submitting the same leads. */
  private qualifying = false;

  /**
   * Qualify unscored leads with Claude — a 0–100 buyer-likelihood score,
   * intent, and extracted interests.
   *
   * Runs as a background job on the 50%-off Message Batches API (bulk scoring
   * isn't latency-sensitive). Returns immediately with how many leads were
   * QUEUED; scores land in the list as the batch completes (usually a minute or
   * two, up to the batch SLA). Same Haiku model/prompt as before — the only
   * change is async + half price.
   */
  async qualifyLeads(limit = 40): Promise<{ queued: number }> {
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    if (this.qualifying) return { queued: 0 };
    const leads = await this.leadRepo
      .createQueryBuilder('l')
      .where('l.qualifiedAt IS NULL')
      .andWhere("l.status <> 'dismissed'")
      .orderBy('l.createdAt', 'DESC')
      .limit(Math.min(limit, 120))
      .getMany();
    if (leads.length === 0) return { queued: 0 };

    this.qualifying = true;
    // Fire-and-forget — submit the batch and apply scores when it finishes.
    void this.runQualifyBatch(leads).finally(() => {
      this.qualifying = false;
    });
    return { queued: leads.length };
  }

  /** Score a set of leads via one batch job, then persist the results. */
  private async runQualifyBatch(leads: DiscoveredLead[]): Promise<void> {
    const INTENTS = ['buying', 'selling', 'showcase', 'discussion', 'off_topic'];
    const system =
      'You qualify trading-card / collectibles marketplace leads. For each social post, judge whether the AUTHOR is a likely BUYER of cards/collectibles and score their buying likelihood 0-100 (higher = clearer buying intent, e.g. "ISO", "WTB", "looking for"). Classify intent and extract the specific cards, players, sets, or categories they want.';
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              buyerScore: { type: 'integer' },
              intent: { type: 'string', enum: INTENTS },
              interests: { type: 'array', items: { type: 'string' } },
              reasoning: { type: 'string' },
            },
            required: ['id', 'buyerScore', 'intent', 'interests', 'reasoning'],
          },
        },
      },
      required: ['results'],
    };

    // One batch request per ~12 leads.
    const requests: {
      customId: string;
      system: string;
      prompt: string;
      schema: Record<string, unknown>;
      maxTokens: number;
    }[] = [];
    for (let i = 0; i < leads.length; i += 12) {
      const items = leads.slice(i, i + 12).map((l) => ({
        id: l.id,
        source: l.source,
        community: l.community,
        title: l.title,
        text: (l.text ?? '').slice(0, 500),
      }));
      requests.push({
        customId: `q${i}`,
        system,
        prompt: `Leads (JSON):\n${JSON.stringify(
          items,
        )}\n\nReturn JSON {"results":[{"id","buyerScore","intent","interests","reasoning"}]} with one entry per lead id.`,
        schema,
        maxTokens: 4000,
      });
    }

    try {
      const results = await this.ai.runJsonBatch<{
        results?: {
          id: string;
          buyerScore: number;
          intent: string;
          interests: string[];
          reasoning: string;
        }[];
      }>({
        // Bulk lead scoring is a narrow classification task — Haiku 4.5 is
        // near-Opus here at ~1/5 the cost; the Batch API halves it again.
        model: 'claude-haiku-4-5',
        requests,
      });

      const byId = new Map(leads.map((l) => [l.id, l]));
      const now = new Date();
      let scored = 0;
      for (const out of results.values()) {
        for (const r of out.results ?? []) {
          const lead = byId.get(r.id);
          if (!lead) continue;
          lead.buyerScore = Math.max(0, Math.min(100, Math.round(r.buyerScore)));
          lead.intent = INTENTS.includes(r.intent) ? r.intent : 'discussion';
          lead.interests = Array.isArray(r.interests)
            ? r.interests.filter((x) => typeof x === 'string').slice(0, 8)
            : [];
          lead.qualifyReasoning = (r.reasoning ?? '').slice(0, 500);
          lead.qualifiedAt = now;
          await this.leadRepo.save(lead);
          scored++;
        }
      }
      this.logger.log(`Qualify batch scored ${scored}/${leads.length} lead(s).`);
    } catch (e) {
      this.logger.warn(`qualify batch failed: ${(e as Error).message}`);
    }
  }

  /**
   * Claude expands a topic into higher-signal search inputs for a source —
   * buying-intent phrasings, specific set/player terms, and relevant subreddits.
   */
  async suggestQueries(
    topic: string,
    source: string,
  ): Promise<{ terms: string[]; subreddits: string[]; rationale: string }> {
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    if (!topic.trim()) {
      return { terms: [], subreddits: [], rationale: '' };
    }
    return this.ai.generateJson<{
      terms: string[];
      subreddits: string[];
      rationale: string;
    }>({
      system:
        'You optimize search queries for finding trading-card BUYERS (not sellers) on social platforms and forums. Favor buying-intent phrasing like "ISO", "WTB", "LF", "looking for", "want to buy", plus specific set/player/card names.',
      prompt: `Goal: find likely buyers for "${topic}" on ${source}.\nReturn JSON {"terms":[5-8 high-signal search phrases],"subreddits":[up to 6 relevant subreddit names WITHOUT the "r/"],"rationale":"one sentence"}.`,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          terms: { type: 'array', items: { type: 'string' } },
          subreddits: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
        required: ['terms', 'subreddits', 'rationale'],
      },
      maxTokens: 700,
    });
  }

  /** Counts by source and status for the dashboard header. */
  async leadStats(): Promise<{
    total: number;
    bySource: Record<string, number>;
    byStatus: Record<string, number>;
  }> {
    const rows = await this.leadRepo
      .createQueryBuilder('l')
      .select('l.source', 'source')
      .addSelect('l.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.source')
      .addGroupBy('l.status')
      .getRawMany<{ source: string; status: string; count: string }>();
    const bySource: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const c = Number(r.count) || 0;
      total += c;
      bySource[r.source] = (bySource[r.source] ?? 0) + c;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + c;
    }
    return { total, bySource, byStatus };
  }

  /** Dismiss / restore a lead. */
  async setLeadStatus(
    source: string,
    externalId: string,
    status: 'new' | 'dismissed',
  ): Promise<{ source: string; externalId: string; status: string }> {
    const lead = await this.leadRepo.findOne({ where: { source, externalId } });
    if (!lead) throw new NotFoundException('Lead not found');
    lead.status = status;
    await this.leadRepo.save(lead);
    return { source, externalId, status };
  }

  private fromReddit(r: RedditPost): DiscoveryLead {
    return {
      id: r.id,
      platform: 'reddit',
      author: r.author,
      authorDisplay: null,
      community: r.subreddit,
      title: r.title,
      text: r.snippet,
      url: r.permalink || r.url,
      upvotes: r.score,
      comments: r.numComments,
      reposts: null,
      createdAt: r.createdUtc,
    };
  }

  private fromBluesky(b: {
    rkey: string;
    handle: string;
    displayName: string | null;
    text: string;
    url: string;
    likeCount: number;
    repostCount: number;
    replyCount: number;
    createdAt: string | null;
  }): DiscoveryLead {
    const ts = b.createdAt ? Date.parse(b.createdAt) : NaN;
    return {
      id: `${b.handle}/${b.rkey}`,
      platform: 'bluesky',
      author: b.handle,
      authorDisplay: b.displayName,
      community: null,
      title: null,
      text: b.text,
      url: b.url,
      upvotes: b.likeCount,
      comments: b.replyCount,
      reposts: b.repostCount,
      createdAt: Number.isFinite(ts) ? Math.floor(ts / 1000) : 0,
    };
  }

  private fromYoutube(l: YoutubeLead): DiscoveryLead {
    const ts = l.publishedAt ? Date.parse(l.publishedAt) : NaN;
    return {
      id: l.commentId || `${l.videoId}:${l.author}`,
      platform: 'youtube',
      author: l.author,
      authorDisplay: null,
      community: null,
      title: `re: ${l.videoTitle}`,
      text: l.text,
      url: l.url,
      upvotes: l.likeCount,
      comments: null,
      reposts: null,
      createdAt: Number.isFinite(ts) ? Math.floor(ts / 1000) : 0,
    };
  }

  private fromGoogle(h: GoogleSearchHit): DiscoveryLead {
    return {
      id: h.link,
      platform: 'google',
      author: h.displayLink,
      authorDisplay: null,
      community: h.displayLink,
      title: h.title,
      text: h.snippet,
      url: h.link,
      upvotes: null,
      comments: null,
      reposts: null,
      createdAt: 0,
    };
  }

  private fromTwitch(c: TwitchChannel): DiscoveryLead {
    const ts = c.startedAt ? Date.parse(c.startedAt) : NaN;
    return {
      id: c.id || c.login,
      platform: 'twitch',
      author: c.login,
      authorDisplay: c.displayName,
      community: c.gameName,
      title: c.title || null,
      text: c.isLive
        ? `🔴 Live now${c.gameName ? ` · ${c.gameName}` : ''}`
        : c.gameName
          ? `Plays ${c.gameName}`
          : '',
      url: c.url,
      upvotes: null,
      comments: null,
      reposts: null,
      createdAt: c.isLive && Number.isFinite(ts) ? Math.floor(ts / 1000) : 0,
    };
  }

  /**
   * Compliant external discovery via Reddit's official API: search public
   * posts in card/collectible subreddits for buying intent and surface the
   * posters as prospect leads. Returns `configured: false` (with no posts)
   * when Reddit OAuth isn't set up, so the UI can prompt for credentials.
   */
  async discoverReddit(opts: {
    query: string;
    subreddit?: string;
    sort?: 'relevance' | 'new' | 'top' | 'comments';
    time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
    limit?: number;
  }): Promise<{ configured: boolean; posts: RedditPost[] }> {
    if (!this.reddit.isConfigured()) {
      return { configured: false, posts: [] };
    }
    const posts = await this.reddit.searchPosts(opts);
    return { configured: true, posts };
  }

  /** Run all connectors for one user and upsert their normalized signals. */
  async collectForUser(userId: string): Promise<ExternalSignal[]> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const ap = (user.analyticsProfile ?? {}) as Record<string, unknown>;
    const analyticsSocials: AnalyticsProfileSocialEntry[] = Array.isArray(
      ap.socials,
    )
      ? (ap.socials as AnalyticsProfileSocialEntry[])
      : [];

    const ctx: ConnectorUserContext = {
      userId,
      publicSocials: user.socials ?? null,
      analyticsSocials,
    };

    const collected: NormalizedSignal[] = [];
    for (const connector of this.connectors) {
      try {
        collected.push(...(await connector.collectForUser(ctx)));
      } catch (e) {
        this.logger.warn(
          `connector ${connector.key} failed for ${userId}: ${
            e instanceof Error ? e.message : e
          }`,
        );
      }
    }

    const now = new Date();
    for (const s of collected) {
      const existing = await this.signalRepo.findOne({
        where: {
          userId,
          platform: s.platform,
          handle: s.handle,
          source: s.source,
        },
      });
      if (existing) {
        existing.url = s.url ?? existing.url;
        existing.label = s.label ?? existing.label;
        existing.signalType = s.signalType ?? existing.signalType;
        existing.data = s.data ?? existing.data;
        existing.confidence = s.confidence ?? existing.confidence;
        existing.collectedAt = now;
        await this.signalRepo.save(existing);
      } else {
        await this.signalRepo.save(
          this.signalRepo.create({
            userId,
            platform: s.platform,
            handle: s.handle,
            url: s.url ?? null,
            source: s.source,
            signalType: s.signalType ?? 'handle',
            label: s.label ?? null,
            data: s.data ?? null,
            confidence: s.confidence ?? null,
            collectedAt: now,
          }),
        );
      }
    }

    return this.listSignals(userId);
  }

  /** All stored signals for a user, freshest first. */
  async listSignals(userId: string): Promise<ExternalSignal[]> {
    return this.signalRepo.find({
      where: { userId },
      order: { collectedAt: 'DESC', platform: 'ASC' },
    });
  }
}
