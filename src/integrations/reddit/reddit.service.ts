import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface RedditPost {
  id: string;
  author: string;
  subreddit: string;
  title: string;
  snippet: string;
  url: string;
  permalink: string;
  score: number;
  numComments: number;
  createdUtc: number;
}

interface RedditChild {
  kind: string;
  data: {
    id: string;
    author: string;
    subreddit: string;
    title: string;
    selftext?: string;
    url?: string;
    permalink?: string;
    score?: number;
    num_comments?: number;
    created_utc?: number;
  };
}

/**
 * Reddit official-API client for compliant buyer discovery — search public
 * posts in card/collectible subreddits for buying intent and surface the
 * posting users as prospect leads.
 *
 * Requires `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (a Reddit "web app" or
 * "script" OAuth app). `REDDIT_USER_AGENT` is recommended (Reddit enforces a
 * descriptive UA). Dormant when unconfigured — `isConfigured()` is false and
 * the app still boots.
 *
 * Uses application-only OAuth (`client_credentials`) for read-only public
 * data. Free tier allows ~100 requests/min per OAuth client; heavy/commercial
 * use should review Reddit's Data API terms.
 */
@Injectable()
export class RedditService {
  private readonly logger = new Logger(RedditService.name);
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly userAgent: string;

  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {
    this.clientId =
      this.config.get<string>('REDDIT_CLIENT_ID') ??
      process.env.REDDIT_CLIENT_ID;
    this.clientSecret =
      this.config.get<string>('REDDIT_CLIENT_SECRET') ??
      process.env.REDDIT_CLIENT_SECRET;
    this.userAgent =
      this.config.get<string>('REDDIT_USER_AGENT') ??
      process.env.REDDIT_USER_AGENT ??
      'CardCade/1.0 (analytics discovery)';
    if (!this.isConfigured()) {
      this.logger.warn(
        'REDDIT_CLIENT_ID/SECRET not set — Reddit discovery is dormant.',
      );
    }
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 30_000) return this.token;

    const basic = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64');
    const res = await axios.post<{ access_token: string; expires_in: number }>(
      'https://www.reddit.com/api/v1/access_token',
      new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      {
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
        },
        timeout: 15_000,
      },
    );
    this.token = res.data.access_token;
    this.tokenExpiresAt = now + (res.data.expires_in ?? 3600) * 1000;
    return this.token;
  }

  /**
   * Search public posts. When `subreddit` is set the search is restricted to
   * it; otherwise it's a site-wide search. `sort`: relevance | new | top |
   * comments. `time`: hour | day | week | month | year | all.
   */
  async searchPosts(opts: {
    query: string;
    subreddit?: string;
    sort?: 'relevance' | 'new' | 'top' | 'comments';
    time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
    limit?: number;
  }): Promise<RedditPost[]> {
    const token = await this.getToken();
    const sub = opts.subreddit?.replace(/^\/?r\//i, '').trim();
    const path = sub
      ? `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/search`
      : 'https://oauth.reddit.com/search';

    const res = await axios.get<{ data?: { children?: RedditChild[] } }>(path, {
      params: {
        q: opts.query,
        sort: opts.sort ?? 'relevance',
        t: opts.time ?? 'month',
        limit: Math.min(opts.limit ?? 25, 100),
        type: 'link',
        ...(sub ? { restrict_sr: 1 } : {}),
      },
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': this.userAgent,
      },
      timeout: 20_000,
    });

    const children = res.data?.data?.children ?? [];
    return children
      .filter((c) => c.kind === 't3' && c.data?.author && c.data.author !== '[deleted]')
      .map((c) => {
        const d = c.data;
        const snippet = (d.selftext ?? '').replace(/\s+/g, ' ').trim();
        return {
          id: d.id,
          author: d.author,
          subreddit: d.subreddit,
          title: d.title,
          snippet: snippet.length > 280 ? `${snippet.slice(0, 280)}…` : snippet,
          url: d.url ?? '',
          permalink: d.permalink
            ? `https://www.reddit.com${d.permalink}`
            : '',
          score: d.score ?? 0,
          numComments: d.num_comments ?? 0,
          createdUtc: d.created_utc ?? 0,
        };
      });
  }
}
