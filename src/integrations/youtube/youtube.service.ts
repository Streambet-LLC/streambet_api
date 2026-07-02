import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface YoutubeLead {
  commentId: string;
  author: string;
  channelUrl: string | null;
  text: string;
  videoTitle: string;
  videoId: string;
  url: string;
  likeCount: number;
  publishedAt: string | null;
}

interface YtSearchResp {
  items?: { id?: { videoId?: string }; snippet?: { title?: string } }[];
}
interface YtCommentResp {
  items?: {
    snippet?: {
      topLevelComment?: {
        id?: string;
        snippet?: {
          authorDisplayName?: string;
          authorChannelUrl?: string;
          textOriginal?: string;
          textDisplay?: string;
          likeCount?: number;
          publishedAt?: string;
        };
      };
    };
  }[];
}

/**
 * YouTube buyer discovery via the official Data API. Searches break/opener
 * videos for a query, then mines their top comments — people commenting on
 * rip/break videos are highly engaged buyers. Returns the commenters as leads.
 *
 * Requires `YOUTUBE_API_KEY` (a simple Data API key — no OAuth). Dormant when
 * unset. Free quota (~10k units/day): each discovery search ≈ 100 units for
 * the video search + 1 per video for comments.
 */
@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);
  private readonly apiKey?: string;
  private readonly base = 'https://www.googleapis.com/youtube/v3';

  constructor(private readonly config: ConfigService) {
    this.apiKey =
      this.config.get<string>('YOUTUBE_API_KEY') ?? process.env.YOUTUBE_API_KEY;
    if (!this.apiKey) {
      this.logger.warn('YOUTUBE_API_KEY not set — YouTube discovery is dormant.');
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** Search videos for the query, then return deduped commenters as leads. */
  async searchCommenters(opts: {
    query: string;
    limit?: number;
  }): Promise<YoutubeLead[]> {
    const limit = Math.min(opts.limit ?? 50, 100);

    const search = await axios.get<YtSearchResp>(`${this.base}/search`, {
      params: {
        key: this.apiKey,
        part: 'snippet',
        type: 'video',
        q: opts.query,
        maxResults: 6,
        order: 'relevance',
      },
      timeout: 20_000,
    });
    const videos = (search.data.items ?? [])
      .map((i) => ({ id: i.id?.videoId, title: i.snippet?.title ?? '' }))
      .filter((v): v is { id: string; title: string } => !!v.id);

    const out: YoutubeLead[] = [];
    const seenAuthors = new Set<string>();

    for (const video of videos) {
      if (out.length >= limit) break;
      try {
        const comments = await axios.get<YtCommentResp>(
          `${this.base}/commentThreads`,
          {
            params: {
              key: this.apiKey,
              part: 'snippet',
              videoId: video.id,
              maxResults: 20,
              order: 'relevance',
              textFormat: 'plainText',
            },
            timeout: 20_000,
          },
        );
        for (const item of comments.data.items ?? []) {
          const c = item.snippet?.topLevelComment;
          const s = c?.snippet;
          const author = s?.authorDisplayName;
          if (!author || seenAuthors.has(author)) continue;
          seenAuthors.add(author);
          const text = (s?.textOriginal ?? s?.textDisplay ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          out.push({
            commentId: c?.id ?? '',
            author,
            channelUrl: s?.authorChannelUrl ?? null,
            text: text.length > 300 ? `${text.slice(0, 300)}…` : text,
            videoTitle: video.title,
            videoId: video.id,
            url: c?.id
              ? `https://www.youtube.com/watch?v=${video.id}&lc=${c.id}`
              : `https://www.youtube.com/watch?v=${video.id}`,
            likeCount: s?.likeCount ?? 0,
            publishedAt: s?.publishedAt ?? null,
          });
          if (out.length >= limit) break;
        }
      } catch {
        // Comments disabled / private — skip this video.
      }
    }
    return out;
  }
}
