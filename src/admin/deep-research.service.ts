import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DeepResearchJob } from './entities/deep-research-job.entity';
import { ForecastService } from './forecast.service';
import { AiService, AiImage } from '../integrations/ai/ai.service';
import { AnswerDepth, normalizeDepth } from '../integrations/ai/answer-depth';
import { EbayBrowseSource } from './card-market/ebay-browse.source';

/**
 * Depth ordering for cache reuse. A stored report satisfies a request only if
 * its rank is >= the requested rank — deeper reports are a superset of
 * shallower ones, never the other way round.
 */
const DEPTH_RANK: Record<AnswerDepth, number> = {
  quick: 0,
  balanced: 1,
  deep: 2,
};

export interface DeepResearchJobDto {
  id: string;
  subject: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  /** Reference image of the confirmed card, if we have one. */
  imageUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * A card the system thinks the user means, with a reference image so they can
 * VISUALLY confirm it's the right card before we analyze it. Powers the
 * "verify the card" step in both chat and the AI Market Reports panel.
 */
export interface CardCandidate {
  /** Whether this resolves to a real, identifiable trading card. */
  isCard: boolean;
  /** Refined canonical search string for market research. */
  subject: string;
  /** Clean display name of the card. */
  name: string;
  /** Direct, hotlinkable reference image URL (card front), or null. */
  imageUrl: string | null;
  brand: string | null;
  set: string | null;
  number: string | null;
  grade: string | null;
  /** How sure we are about the match. */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Runs "deep dive" predictive research in the background so the Insights chat
 * stays fast. `start()` records a job and kicks off the heavyweight
 * (web-research) analysis without awaiting it; the Deep Dives panel polls
 * `list()` for results.
 */
@Injectable()
export class DeepResearchService implements OnModuleInit {
  private readonly logger = new Logger(DeepResearchService.name);

  constructor(
    @InjectRepository(DeepResearchJob)
    private readonly repo: Repository<DeepResearchJob>,
    private readonly forecast: ForecastService,
    private readonly ai: AiService,
    private readonly ebay: EbayBrowseSource,
  ) {}

  /**
   * Any job left 'pending'/'running' from a previous process is orphaned (the
   * in-process runner didn't survive the restart) — fail it so the UI doesn't
   * spin forever.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.repo.update(
        { status: In(['pending', 'running']) },
        { status: 'error', error: 'Interrupted by a server restart.' },
      );
    } catch (e) {
      this.logger.warn(`Orphan cleanup skipped: ${(e as Error).message}`);
    }
  }

  async start(
    subject: string,
    adminId?: string,
    rawDepth?: unknown,
    imageUrl?: string | null,
  ): Promise<DeepResearchJobDto> {
    const clean = (subject ?? '').trim().slice(0, 300);
    if (!clean) throw new BadRequestException('A subject is required.');
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    const depth = normalizeDepth(rawDepth);
    // Reuse a recent completed report for the same subject rather than re-run a
    // full (expensive) web-research job — the market rarely moves enough in a
    // day to justify a fresh dive, and the admin gets the result instantly.
    // Only reuse one at least as deep as what was asked for, so raising the
    // depth setting actually re-runs instead of returning the shallower report.
    const reuse = await this.recentDone(clean, depth);
    if (reuse) return this.toDto(reuse);
    const job = await this.repo.save(
      this.repo.create({
        subject: clean,
        status: 'pending',
        depth,
        requestedByAdminId: adminId ?? null,
        imageUrl: this.cleanImageUrl(imageUrl),
      }),
    );
    // Fire-and-forget — the response returns immediately.
    void this.run(job.id, depth);
    return this.toDto(job);
  }

  /**
   * Start a deep dive from a PHOTO of a card. Runs a quick vision pass to
   * identify the card (game, player/character, set, number, variant, and any
   * grade), then hands the derived subject to the normal `start()` flow — so
   * reuse/freshness caching and the background runner all apply unchanged.
   * `note` is optional admin context to disambiguate (e.g. "the PSA 10").
   */
  async startFromImage(
    images: AiImage[],
    note?: string,
    adminId?: string,
    rawDepth?: unknown,
  ): Promise<DeepResearchJobDto> {
    const { isCard, subject } = await this.identifyImage(images, note, adminId);
    if (!isCard || !subject) {
      throw new BadRequestException(
        "Couldn't identify a card in that photo. Try a clearer, well-lit shot of the front, or add a note naming the card.",
      );
    }
    return this.start(subject, adminId, rawDepth);
  }

  /**
   * Vision-identify the card in a photo WITHOUT starting a job — powers the
   * "is this the right card?" confirmation step. Returns the best-guess subject
   * (empty when it isn't a recognizable trading card) so the UI can show it for
   * the admin to confirm or edit before committing to a (heavy) research run.
   */
  async identifyImage(
    images: AiImage[],
    note?: string,
    adminId?: string,
  ): Promise<{ isCard: boolean; subject: string }> {
    if (!images || images.length === 0) {
      throw new BadRequestException('A photo is required.');
    }
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    try {
      const res = await this.ai.generateJson<{
        isCard: boolean;
        subject: string;
      }>({
        model: this.ai.chatModel,
        maxTokens: 300,
        images: images.slice(0, 2),
        system:
          'You identify trading cards (Pokémon, One Piece, sports, and other ' +
          'collectibles) from photos for a card-market research tool. Read the ' +
          'card as precisely as the image allows.',
        prompt:
          'Identify the card in the photo(s) and return JSON. `subject` must be ' +
          'a single concise search string a market analyst would use — include ' +
          'game/brand, player or character, set/series, card number, variant/' +
          'parallel (holo, alt art, prizm, etc.), year, and — if it is a graded ' +
          'slab — the grader and grade (e.g. "PSA 10"). Example: "Pokémon Crown ' +
          'Zenith Charizard VSTAR UPC #GG69 PSA 10". If the image is not a ' +
          'trading card, set isCard=false and subject="".' +
          (note ? `\n\nAdmin note (use to disambiguate): ${note}` : ''),
        schema: {
          type: 'object',
          properties: {
            isCard: { type: 'boolean' },
            subject: { type: 'string' },
          },
          required: ['isCard', 'subject'],
          additionalProperties: false,
        },
        meta: { feature: 'deep_dive_identify', adminId },
      });
      const subject = (res.subject ?? '').trim().slice(0, 300);
      return { isCard: !!res.isCard && !!subject, subject };
    } catch (e) {
      this.logger.warn(`card identify failed: ${(e as Error).message}`);
      throw new BadRequestException(
        'Could not analyze that photo. Please try again.',
      );
    }
  }

  /**
   * Identify + normalize a card from a TEXT subject — FAST, no web search — so
   * the admin sees a clean card name to confirm almost instantly. The reference
   * image is fetched separately (findCardImage) so a slow image lookup never
   * blocks the name. Degrades to a name-only candidate on any error.
   */
  async identifyCard(
    subject: string,
    adminId?: string,
  ): Promise<CardCandidate> {
    const clean = (subject ?? '').trim().slice(0, 300);
    if (!clean) throw new BadRequestException('A card is required.');
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    // Assume it's a card (the admin asked about it) so any blip still lets them
    // confirm by name.
    const fallback: CardCandidate = {
      isCard: true,
      subject: clean,
      name: clean,
      imageUrl: null,
      brand: null,
      set: null,
      number: null,
      grade: null,
      confidence: 'low',
    };
    try {
      const res = await this.ai.generateJson<Partial<CardCandidate>>({
        model: this.ai.chatModel,
        maxTokens: 500,
        system:
          'You identify and normalize trading-card names (Pokémon, One Piece, ' +
          'sports, and other collectibles) precisely from a short description.',
        prompt:
          'Normalize the card the user described into a clean, canonical ' +
          'trading-card identity so they can confirm it before we analyze it.' +
          `\n\nUser's description: "${clean}"\n\n` +
          'Return JSON with: isCard (is this a real, identifiable trading ' +
          'card?), name (clean display name, e.g. "Charizard VSTAR — Crown ' +
          'Zenith UPC #GG69"), subject (a canonical search string a market ' +
          'analyst would use), brand, set, number, grade (best-known identity ' +
          'fields, or null), and confidence ("high" | "medium" | "low"). Do ' +
          'NOT include an image. If it is not a card, set isCard=false.',
        schema: {
          type: 'object',
          properties: {
            isCard: { type: 'boolean' },
            name: { type: 'string' },
            subject: { type: 'string' },
            brand: { type: ['string', 'null'] },
            set: { type: ['string', 'null'] },
            number: { type: ['string', 'null'] },
            grade: { type: ['string', 'null'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['isCard', 'name', 'subject'],
          additionalProperties: false,
        },
        meta: { feature: 'card_identify', adminId },
      });
      const confidence =
        res.confidence === 'high' ||
        res.confidence === 'medium' ||
        res.confidence === 'low'
          ? res.confidence
          : 'low';
      return {
        isCard: res.isCard !== false,
        subject: (this.strOrNull(res.subject) ?? clean).slice(0, 300),
        name: (this.strOrNull(res.name) ?? clean).slice(0, 200),
        imageUrl: null,
        brand: this.strOrNull(res.brand),
        set: this.strOrNull(res.set),
        number: this.strOrNull(res.number),
        grade: this.strOrNull(res.grade),
        confidence,
      };
    } catch (e) {
      this.logger.warn(`card identify (text) failed: ${(e as Error).message}`);
      return fallback;
    }
  }

  /**
   * Find a reference image for a card. For Pokémon we hit the free Pokémon TCG
   * API (pokemontcg.io) — fast, exact, hotlinkable images. For everything else
   * (or if that misses) we fall back to a hard-bounded web search that can
   * NEVER hang the UI: few searches and an abort at ~14s. Returns
   * { imageUrl: null } when nothing reliable is found (the confirm step then
   * shows name-only). Called separately from identifyCard so a slow image never
   * delays the card name.
   */
  async findCardImage(
    hint: {
      subject: string;
      name?: string | null;
      brand?: string | null;
      number?: string | null;
    },
    adminId?: string,
  ): Promise<{ imageUrl: string | null }> {
    const subject = (hint.subject ?? '').trim().slice(0, 300);
    if (!subject) return { imageUrl: null };

    // 1) Pokémon → the Pokémon TCG API (fast, exact, allows hotlinking).
    const haystack =
      `${hint.brand ?? ''} ${hint.name ?? ''} ${subject}`.toLowerCase();
    if (/pok[eé]mon|pokemon/.test(haystack)) {
      const url = await this.pokemonTcgImage(
        hint.name || subject,
        hint.number,
      );
      if (url) return { imageUrl: url };
    }

    // 2) eBay Browse — a real photo from the top listing. Fast (~1s), works for
    // virtually any card (sports included), and far more reliable than the slow
    // web_search URL hunt that kept aborting.
    try {
      const ebayImg = await this.ebay.imageFor(subject);
      const cleaned = this.cleanImageUrl(ebayImg);
      if (cleaned) return { imageUrl: cleaned };
    } catch {
      /* eBay is best-effort */
    }

    // 3) Last resort → bounded web search (any game), never blocking for long.
    if (!this.ai.isConfigured()) return { imageUrl: null };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 14000);
    try {
      const res = await this.ai.research<{ imageUrl?: string | null }>({
        model: this.ai.chatModel,
        maxTokens: 700,
        maxSearches: 2,
        maxRounds: 3,
        effort: 'low',
        signal: ctrl.signal,
        prompt:
          'Find a DIRECT, hotlinkable image URL of the FRONT of this trading ' +
          `card: "${subject}".\n\n` +
          'Strongly prefer stable CDNs that allow hotlinking: eBay ' +
          '(i.ebayimg.com), TCGplayer (tcgplayer-cdn.tcgplayer.com), ' +
          'PriceCharting, or Cardmarket. The URL must point directly at an ' +
          'image file (.jpg/.jpeg/.png/.webp) or a direct image endpoint — not ' +
          'a web page. Do ONE quick search, then answer.\n\n' +
          'Return JSON: { "imageUrl": "<direct image URL>" } — or ' +
          '{ "imageUrl": null } if you cannot find a reliable one. NEVER invent ' +
          'or guess a URL.',
        meta: { feature: 'card_image', adminId },
      });
      return { imageUrl: this.cleanImageUrl(res.imageUrl) };
    } catch (e) {
      this.logger.warn(`card image lookup failed: ${(e as Error).message}`);
      return { imageUrl: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Look up a card image from the free Pokémon TCG API. Queries by the core
   * card name (+ number when we have one), preferring an exact number match and
   * the most recent printing. Returns the hi-res image URL, or null. A
   * POKEMONTCG_API_KEY env var (optional) raises the rate limit.
   */
  private async pokemonTcgImage(
    name: string,
    number?: string | null,
  ): Promise<string | null> {
    // The core card name — drop any "— <set/PSA>" or "(...)" suffix we appended.
    const core = (name || '')
      .split(/[—(]/)[0]
      .replace(/["\\]/g, '')
      .trim();
    if (!core) return null;
    const num = (number ?? '').replace(/[^0-9A-Za-z]/g, '').trim();
    const key = process.env.POKEMONTCG_API_KEY;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (key) headers['X-Api-Key'] = key;

    const tryQuery = async (q: string): Promise<string | null> => {
      const url =
        'https://api.pokemontcg.io/v2/cards?pageSize=8&orderBy=-set.releaseDate' +
        `&q=${encodeURIComponent(q)}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      try {
        const r = await fetch(url, { headers, signal: ctrl.signal });
        if (!r.ok) return null;
        const j = (await r.json()) as {
          data?: Array<{
            number?: string;
            images?: { large?: string; small?: string };
          }>;
        };
        const cards = j.data ?? [];
        if (cards.length === 0) return null;
        // Prefer an exact card-number match when we have one.
        const pick =
          (num &&
            cards.find(
              c => (c.number ?? '').toLowerCase() === num.toLowerCase(),
            )) ||
          cards[0];
        return pick.images?.large ?? pick.images?.small ?? null;
      } catch {
        return null;
      } finally {
        clearTimeout(t);
      }
    };

    // Name + number first (most specific), then name-only.
    if (num) {
      const withNum = await tryQuery(`name:"${core}" number:"${num}"`);
      if (withNum) return withNum;
    }
    return tryQuery(`name:"${core}"`);
  }

  private strOrNull(v: unknown): string | null {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, 200) : null;
  }

  /** Only accept a plausible absolute http(s) image URL; otherwise null. */
  private cleanImageUrl(v: unknown): string | null {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!/^https?:\/\/\S+$/i.test(s)) return null;
    return s.slice(0, 1000);
  }

  /**
   * Most recent completed dive for this subject within the freshness window
   * that is AT LEAST as deep as the one being asked for.
   *
   * The depth check is the point: a Brief report is not an acceptable answer
   * to a Deep request, and handing one back is what made the depth setting
   * look broken. The reverse is fine — a Deep report already contains
   * everything a Brief one would, so asking for Brief happily reuses it.
   */
  private async recentDone(
    subject: string,
    depth: AnswerDepth,
  ): Promise<DeepResearchJob | null> {
    try {
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
      const candidates = await this.repo
        .createQueryBuilder('j')
        .where('LOWER(j.subject) = LOWER(:subject)', { subject })
        .andWhere('j.status = :s', { s: 'done' })
        .andWhere('j.completedAt >= :cutoff', { cutoff })
        .orderBy('j.completedAt', 'DESC')
        .take(20)
        .getMany();
      const want = DEPTH_RANK[depth];
      return (
        candidates.find((j) => DEPTH_RANK[normalizeDepth(j.depth)] >= want) ??
        null
      );
    } catch (e) {
      this.logger.warn(`deep-research reuse check failed: ${(e as Error).message}`);
      return null;
    }
  }

  private async run(id: string, depth: AnswerDepth = 'balanced'): Promise<void> {
    try {
      await this.repo.update(id, { status: 'running', startedAt: new Date() });
      const job = await this.repo.findOne({ where: { id } });
      if (!job) return;
      // Backfill a reference image for dives started without one (e.g. from the
      // chat's start_deep_dive tool) — best-effort, doesn't fail the job.
      if (!job.imageUrl) {
        try {
          const { imageUrl } = await this.findCardImage(
            { subject: job.subject },
            job.requestedByAdminId ?? undefined,
          );
          if (imageUrl) await this.repo.update(id, { imageUrl });
        } catch {
          /* image is optional — never block the report on it */
        }
      }
      const result = await this.forecast.researchSubject(
        job.subject,
        job.requestedByAdminId ?? undefined,
        depth,
      );
      await this.repo.update(id, {
        status: 'done',
        result: result as unknown as Record<string, unknown>,
        completedAt: new Date(),
      });
    } catch (e) {
      this.logger.warn(`Deep dive ${id} failed: ${(e as Error).message}`);
      await this.repo.update(id, {
        status: 'error',
        error: (e as Error).message.slice(0, 500),
        completedAt: new Date(),
      });
    }
  }

  async get(id: string): Promise<DeepResearchJobDto | null> {
    try {
      const job = await this.repo.findOne({ where: { id } });
      return job ? this.toDto(job) : null;
    } catch (e) {
      // Degrade gracefully if the table isn't migrated yet (avoids a 500).
      this.logger.warn(`deep-research get failed: ${(e as Error).message}`);
      return null;
    }
  }

  async list(
    limit = 20,
    offset = 0,
  ): Promise<{ total: number; data: DeepResearchJobDto[] }> {
    try {
      const [rows, total] = await this.repo.findAndCount({
        order: { createdAt: 'DESC' },
        take: Math.min(Math.max(limit, 1), 50),
        skip: Math.max(offset, 0),
      });
      return { total, data: rows.map((r) => this.toDto(r)) };
    } catch (e) {
      this.logger.warn(`deep-research list failed: ${(e as Error).message}`);
      return { total: 0, data: [] };
    }
  }

  private toDto(j: DeepResearchJob): DeepResearchJobDto {
    return {
      id: j.id,
      subject: j.subject,
      status: j.status,
      result: j.result ?? null,
      error: j.error ?? null,
      imageUrl: j.imageUrl ?? null,
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
    };
  }
}
