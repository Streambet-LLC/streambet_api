import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface TwitchChannel {
  id: string;
  login: string;
  displayName: string;
  title: string;
  gameName: string | null;
  isLive: boolean;
  url: string;
  startedAt: string | null;
}

interface HelixSearchResp {
  data?: {
    id?: string;
    broadcaster_login?: string;
    display_name?: string;
    title?: string;
    game_name?: string;
    is_live?: boolean;
    started_at?: string;
  }[];
}

/**
 * Twitch discovery via the official Helix API. Searches channels by query to
 * find active card **breakers / streamers** (community hubs and sellers) for a
 * given term. Creator-leaning (vs. buyer), but high-value for partnerships and
 * seeding seller/influencer outreach.
 *
 * Requires `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` (a Twitch dev app, free).
 * Dormant when unset. Uses app-access-token OAuth (`client_credentials`).
 */
@Injectable()
export class TwitchService {
  private readonly logger = new Logger(TwitchService.name);
  private readonly clientId?: string;
  private readonly clientSecret?: string;

  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {
    this.clientId =
      this.config.get<string>('TWITCH_CLIENT_ID') ??
      process.env.TWITCH_CLIENT_ID;
    this.clientSecret =
      this.config.get<string>('TWITCH_CLIENT_SECRET') ??
      process.env.TWITCH_CLIENT_SECRET;
    if (!this.isConfigured()) {
      this.logger.warn(
        'TWITCH_CLIENT_ID/SECRET not set — Twitch discovery is dormant.',
      );
    }
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 60_000) return this.token;
    const res = await axios.post<{ access_token: string; expires_in: number }>(
      'https://id.twitch.tv/oauth2/token',
      new URLSearchParams({
        client_id: this.clientId ?? '',
        client_secret: this.clientSecret ?? '',
        grant_type: 'client_credentials',
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      },
    );
    this.token = res.data.access_token;
    this.tokenExpiresAt = now + (res.data.expires_in ?? 3600) * 1000;
    return this.token;
  }

  /** Search channels whose name/title match the query (live + offline). */
  async searchChannels(opts: {
    query: string;
    limit?: number;
  }): Promise<TwitchChannel[]> {
    const token = await this.getToken();
    const res = await axios.get<HelixSearchResp>(
      'https://api.twitch.tv/helix/search/channels',
      {
        params: {
          query: opts.query,
          first: Math.min(opts.limit ?? 25, 100),
        },
        headers: {
          'Client-Id': this.clientId ?? '',
          Authorization: `Bearer ${token}`,
        },
        timeout: 20_000,
      },
    );
    return (res.data.data ?? [])
      .filter((c) => c.broadcaster_login)
      .map((c) => ({
        id: c.id ?? '',
        login: c.broadcaster_login ?? '',
        displayName: c.display_name ?? c.broadcaster_login ?? '',
        title: c.title ?? '',
        gameName: c.game_name || null,
        isLive: !!c.is_live,
        url: `https://twitch.tv/${c.broadcaster_login}`,
        startedAt: c.started_at || null,
      }));
  }
}
