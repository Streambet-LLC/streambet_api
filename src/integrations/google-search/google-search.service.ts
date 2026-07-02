import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface GoogleSearchHit {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface CseResp {
  items?: {
    title?: string;
    link?: string;
    snippet?: string;
    displayLink?: string;
  }[];
}

/**
 * Web search via the Google Programmable Search (Custom Search JSON API) —
 * the compliant way to reach the long tail (forums, blogs, marketplaces) for
 * buying-intent posts, returning links an admin reviews. No crawling.
 *
 * Requires `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_CX` (a Programmable Search Engine
 * id, ideally scoped to the sites/communities you care about). Free tier is
 * 100 queries/day. Dormant when either is unset.
 */
@Injectable()
export class GoogleSearchService {
  private readonly logger = new Logger(GoogleSearchService.name);
  private readonly apiKey?: string;
  private readonly cx?: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey =
      this.config.get<string>('GOOGLE_CSE_API_KEY') ??
      process.env.GOOGLE_CSE_API_KEY;
    this.cx =
      this.config.get<string>('GOOGLE_CSE_CX') ?? process.env.GOOGLE_CSE_CX;
    if (!this.isConfigured()) {
      this.logger.warn(
        'GOOGLE_CSE_API_KEY/GOOGLE_CSE_CX not set — web search is dormant.',
      );
    }
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.cx);
  }

  async search(opts: {
    query: string;
    limit?: number;
  }): Promise<GoogleSearchHit[]> {
    const res = await axios.get<CseResp>(
      'https://www.googleapis.com/customsearch/v1',
      {
        params: {
          key: this.apiKey,
          cx: this.cx,
          q: opts.query,
          num: Math.min(opts.limit ?? 10, 10),
        },
        timeout: 20_000,
      },
    );
    return (res.data.items ?? []).map((i) => ({
      title: i.title ?? '',
      link: i.link ?? '',
      snippet: (i.snippet ?? '').replace(/\s+/g, ' ').trim(),
      displayLink: i.displayLink ?? '',
    }));
  }
}
