import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiImage, AiService } from '../integrations/ai/ai.service';
import { ValuationService } from '../admin/card-market/valuation.service';
import { AuctionCategory } from '../prize/enums/auction-category.enum';
import type { EstValueComp, EstValueMeta } from './hermes.types';

const ESTIMATE_MODEL = 'claude-opus-5-5';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const CATEGORY_LABEL: Record<AuctionCategory, string> = {
  [AuctionCategory.SPORTS_CARDS]: 'sports trading card',
  [AuctionCategory.TCG]: 'trading card game (TCG) card or sealed product',
  [AuctionCategory.SPORTS_MEMORABILIA]: 'piece of sports memorabilia',
};

/** Share of the point estimate used each side when the model gives no range. */
const FALLBACK_RANGE_SPREAD = 0.15;

const positive = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;

/**
 * The recommended Est. Value as an auction-style range ("$400 – $600"):
 * always low < high, the point (if any) inside it, and both ends rounded
 * outward to two significant figures of the top (whole dollars at minimum).
 * Without a usable range from the model it falls back to ±15% of the point.
 */
export function estimateRange(est: {
  pointUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
}): { pointUsd: number | null; lowUsd: number | null; highUsd: number | null } {
  let point = positive(est.pointUsd);
  let low = positive(est.lowUsd);
  let high = positive(est.highUsd);
  if (low != null && high != null && low > high) [low, high] = [high, low];
  if (point == null) {
    if (low == null || high == null) {
      return { pointUsd: null, lowUsd: null, highUsd: null };
    }
    point = (low + high) / 2;
  }
  if (low == null || low > point) low = point * (1 - FALLBACK_RANGE_SPREAD);
  if (high == null || high < point) high = point * (1 + FALLBACK_RANGE_SPREAD);
  const step = Math.max(1, 10 ** (Math.floor(Math.log10(high)) - 1));
  const lo = Math.max(step, Math.floor(low / step) * step);
  let hi = Math.ceil(high / step) * step;
  if (hi <= lo) hi = lo + step;
  return {
    pointUsd: Math.round(point * 100) / 100,
    lowUsd: lo,
    highUsd: hi,
  };
}

interface RawMemorabiliaValuation {
  estimate?: { pointUsd?: number; lowUsd?: number; highUsd?: number } | null;
  confidencePct?: number;
  comps?: Array<{
    title?: string;
    priceUsd?: number;
    date?: string;
    url?: string;
    source?: string;
  }>;
  note?: string;
}

/**
 * "Pull it for me" Est. Value, in two short steps so neither request runs
 * long enough to hit a proxy timeout:
 *   1. identify — read the photos (plus the admin's title/description) into
 *      one precise search subject the admin can confirm or edit;
 *   2. value — comp-grounded valuation of that subject. Cards reuse the
 *      card-market ValuationService; memorabilia gets its own research pass.
 *      The result is a rounded low–high range (see estimateRange) plus the
 *      point estimate inside it.
 * The result is a recommendation only — the admin accepts or edits it.
 */
@Injectable()
export class AuctionsEstimateService {
  private readonly logger = new Logger(AuctionsEstimateService.name);

  constructor(
    private readonly ai: AiService,
    private readonly valuation: ValuationService,
    private readonly config: ConfigService,
  ) {}

  /** Only fetch images from our own bucket (no SSRF via arbitrary URLs). */
  private isOurBucketUrl(url: string): boolean {
    try {
      const u = new URL(url);
      const bucket = this.config.get<string>('AWS_DEFAULT_S3_BUCKET') || '';
      return (
        u.protocol === 'https:' &&
        u.hostname.endsWith('.amazonaws.com') &&
        (!bucket ||
          u.hostname.startsWith(`${bucket}.`) ||
          u.pathname.startsWith(`/${bucket}/`))
      );
    } catch {
      return false;
    }
  }

  private async loadImages(urls: string[] = []): Promise<AiImage[]> {
    const out: AiImage[] = [];
    for (const url of urls.filter((u) => this.isOurBucketUrl(u)).slice(0, 2)) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !/^image\/(jpeg|png|webp|gif)/.test(type)) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_IMAGE_BYTES) continue;
        out.push({
          data: buf.toString('base64'),
          mediaType: type.split(';')[0],
        });
      } catch (err) {
        this.logger.warn(
          `Estimate image fetch failed: ${(err as Error).message}`,
        );
      }
    }
    return out;
  }

  async identify(params: {
    category: AuctionCategory;
    title?: string;
    description?: string;
    imageUrls?: string[];
    adminId?: string;
  }): Promise<{ identified: boolean; subject: string; notes: string }> {
    const fallback = (params.title ?? '').trim();
    if (!this.ai.isConfigured()) {
      return {
        identified: false,
        subject: fallback,
        notes: 'AI is not configured.',
      };
    }
    const images = await this.loadImages(params.imageUrls);
    if (images.length === 0 && !fallback) {
      throw new BadRequestException('Add a photo or an item name first.');
    }
    try {
      const res = await this.ai.generateJson<{
        identified: boolean;
        subject: string;
        notes: string;
      }>({
        model: ESTIMATE_MODEL,
        maxTokens: 8000,
        images,
        system:
          'You identify collectibles for an auction house so they can be priced against recent sales.',
        prompt:
          `The item is a ${CATEGORY_LABEL[params.category]}. ` +
          'Return `subject`: one concise search string a market analyst would use to find recent sales of this exact item. ' +
          'For cards include year, brand/set, player or character, card number, parallel/variant, serial numbering, autograph/patch, and grader + grade if slabbed. ' +
          'For memorabilia include the player, item type, game-used vs. replica, team/season, signature and authenticator (PSA/DNA, JSA, Beckett, Fanatics, MLB Authenticated). ' +
          'Read only what is visible or stated; if something is unclear, leave it out rather than guess, and mention it in `notes`. ' +
          'Set identified=false only if you cannot tell what the item is.' +
          (fallback ? `\n\nAdmin's item name: ${fallback}` : '') +
          (params.description
            ? `\nAdmin's description: ${params.description.slice(0, 1500)}`
            : ''),
        schema: {
          type: 'object',
          properties: {
            identified: { type: 'boolean' },
            subject: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['identified', 'subject', 'notes'],
          additionalProperties: false,
        },
        meta: { feature: 'hermes_estimate_identify', adminId: params.adminId },
      });
      const subject = (res.subject || fallback).trim().slice(0, 300);
      return {
        identified: !!res.identified && !!subject,
        subject,
        notes: res.notes ?? '',
      };
    } catch (err) {
      this.logger.warn(`Hermes identify failed: ${(err as Error).message}`);
      return {
        identified: false,
        subject: fallback,
        notes:
          "Couldn't read the photos — check the item name and try valuing it.",
      };
    }
  }

  async value(params: {
    category: AuctionCategory;
    subject: string;
    adminId?: string;
  }): Promise<EstValueMeta> {
    const subject = (params.subject ?? '').trim().slice(0, 300);
    if (!subject)
      throw new BadRequestException('Enter what the item is first.');
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured — enter the value manually.',
      );
    }
    const pulledAt = new Date().toISOString();

    if (params.category !== AuctionCategory.SPORTS_MEMORABILIA) {
      const v = await this.valuation.valueCard(subject, params.adminId);
      return {
        subject: v.subject || subject,
        ...estimateRange(v),
        confidencePct: v.confidencePct,
        reliability: v.reliability,
        method: v.method,
        comps: (v.compsUsed ?? []).slice(0, 8).map(
          (c): EstValueComp => ({
            title: c.title ?? null,
            priceUsd: Number(c.priceUsd),
            date: c.date ?? null,
            url: c.url ?? null,
            source: c.sourceType ?? null,
          }),
        ),
        note: v.take ?? v.note ?? null,
        pulledAt,
      };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 50_000);
    try {
      const raw = await this.ai.research<RawMemorabiliaValuation>({
        model: ESTIMATE_MODEL,
        effort: 'medium',
        maxSearches: 6,
        maxRounds: 3,
        signal: ctrl.signal,
        system:
          'You research recent SOLD prices of sports memorabilia for an auction house. Use only prices you retrieve this run; never invent a sale. Output ONLY a JSON object.',
        prompt:
          `Today is ${pulledAt.slice(0, 10)}. Find recent sold prices for: "${subject}". ` +
          'Prefer completed auction results (Goldin, Heritage, Fanatics Collect, SCP/Lelands, PWCC, Hunt) and eBay sold listings over asking prices. ' +
          'Match the exact item type, signature, authentication and game-used status; leave out sales that differ. ' +
          'lowUsd–highUsd is the range you would expect it to sell for at auction today (not the full spread of every sale); pointUsd is the most likely price inside it. ' +
          'Return JSON: {"estimate":{"pointUsd":n,"lowUsd":n,"highUsd":n}|null,"confidencePct":0-100,' +
          '"comps":[{"title":"...","priceUsd":n,"date":"YYYY-MM-DD","url":"...","source":"..."}],"note":"one line on what drives the value"}. ' +
          'If you find no reliable sales, return estimate null and say so in note.',
        meta: {
          feature: 'hermes_estimate_memorabilia',
          adminId: params.adminId,
        },
      });
      const comps = (raw.comps ?? [])
        .filter((c) => Number(c.priceUsd) > 0)
        .slice(0, 8)
        .map(
          (c): EstValueComp => ({
            title: c.title ?? null,
            priceUsd: Number(c.priceUsd),
            date: c.date ?? null,
            url: c.url ?? null,
            source: c.source ?? null,
          }),
        );
      const est = raw.estimate ?? null;
      return {
        subject,
        ...estimateRange({
          pointUsd: est?.pointUsd ?? null,
          lowUsd: est?.lowUsd ?? null,
          highUsd: est?.highUsd ?? null,
        }),
        confidencePct:
          typeof raw.confidencePct === 'number'
            ? Math.max(0, Math.min(100, Math.round(raw.confidencePct)))
            : null,
        reliability:
          comps.length >= 3
            ? 'grounded'
            : comps.length > 0
              ? 'thin'
              : 'unverified',
        method: 'recent-sales',
        comps,
        note: raw.note ?? null,
        pulledAt,
      };
    } catch (err) {
      this.logger.warn(
        `Hermes memorabilia valuation failed: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        "Couldn't pull a value right now — enter it manually or try again.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
