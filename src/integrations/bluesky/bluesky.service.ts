import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface BlueskyPost {
  uri: string;
  rkey: string;
  handle: string;
  displayName: string | null;
  text: string;
  url: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  createdAt: string | null;
}

interface BskyPostView {
  uri: string;
  author?: { handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string };
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  indexedAt?: string;
}

/**
 * Bluesky (AT Protocol) discovery. `app.bsky.feed.searchPosts` requires an
 * authenticated session, so this needs a (free) Bluesky **app password**:
 *   BLUESKY_IDENTIFIER   — handle or email (e.g. cardcade.bsky.social)
 *   BLUESKY_APP_PASSWORD — from Bluesky → Settings → App Passwords
 * Dormant when either is unset.
 *
 * We create a session (accessJwt) and call the PDS host, which proxies to the
 * AppView. The token is cached and re-created on expiry.
 */
@Injectable()
export class BlueskyService {
  private readonly logger = new Logger(BlueskyService.name);
  private readonly host = 'https://bsky.social';
  private readonly identifier?: string;
  private readonly appPassword?: string;

  private accessJwt: string | null = null;
  private tokenAt = 0;

  constructor(private readonly config: ConfigService) {
    this.identifier =
      this.config.get<string>('BLUESKY_IDENTIFIER') ??
      process.env.BLUESKY_IDENTIFIER;
    this.appPassword =
      this.config.get<string>('BLUESKY_APP_PASSWORD') ??
      process.env.BLUESKY_APP_PASSWORD;
    if (!this.isConfigured()) {
      this.logger.warn(
        'BLUESKY_IDENTIFIER/APP_PASSWORD not set — Bluesky discovery is dormant.',
      );
    }
  }

  isConfigured(): boolean {
    return !!(this.identifier && this.appPassword);
  }

  private async getToken(force = false): Promise<string> {
    const now = Date.now();
    // accessJwt lives ~2h; re-create after ~90m or when forced.
    if (!force && this.accessJwt && now - this.tokenAt < 90 * 60_000) {
      return this.accessJwt;
    }
    const res = await axios.post<{ accessJwt: string }>(
      `${this.host}/xrpc/com.atproto.server.createSession`,
      { identifier: this.identifier, password: this.appPassword },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 },
    );
    this.accessJwt = res.data.accessJwt;
    this.tokenAt = now;
    return this.accessJwt;
  }

  async searchPosts(opts: {
    query: string;
    sort?: 'top' | 'latest';
    limit?: number;
  }): Promise<BlueskyPost[]> {
    const call = async (token: string) =>
      axios.get<{ posts?: BskyPostView[] }>(
        `${this.host}/xrpc/app.bsky.feed.searchPosts`,
        {
          params: {
            q: opts.query,
            sort: opts.sort ?? 'top',
            limit: Math.min(opts.limit ?? 25, 100),
          },
          headers: { Authorization: `Bearer ${token}` },
          timeout: 20_000,
        },
      );

    let res;
    try {
      res = await call(await this.getToken());
    } catch (e) {
      // Token likely expired — re-auth once and retry.
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 400) {
        res = await call(await this.getToken(true));
      } else {
        throw e;
      }
    }

    const posts = res.data?.posts ?? [];
    return posts
      .filter((p) => p.author?.handle)
      .map((p) => {
        const handle = p.author?.handle ?? '';
        const rkey = p.uri.split('/').pop() ?? '';
        const text = (p.record?.text ?? '').replace(/\s+/g, ' ').trim();
        return {
          uri: p.uri,
          rkey,
          handle,
          displayName: p.author?.displayName ?? null,
          text: text.length > 300 ? `${text.slice(0, 300)}…` : text,
          url:
            handle && rkey
              ? `https://bsky.app/profile/${handle}/post/${rkey}`
              : '',
          likeCount: p.likeCount ?? 0,
          repostCount: p.repostCount ?? 0,
          replyCount: p.replyCount ?? 0,
          createdAt: p.record?.createdAt ?? p.indexedAt ?? null,
        };
      });
  }
}
