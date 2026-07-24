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

export interface DeepResearchJobDto {
  id: string;
  subject: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
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
  ): Promise<DeepResearchJobDto> {
    const clean = (subject ?? '').trim().slice(0, 300);
    if (!clean) throw new BadRequestException('A subject is required.');
    if (!this.ai.isConfigured()) {
      throw new BadRequestException(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    // Reuse a recent completed report for the same subject rather than re-run a
    // full (expensive) web-research job — the market rarely moves enough in a
    // day to justify a fresh dive, and the admin gets the result instantly.
    const reuse = await this.recentDone(clean);
    if (reuse) return this.toDto(reuse);
    const job = await this.repo.save(
      this.repo.create({
        subject: clean,
        status: 'pending',
        requestedByAdminId: adminId ?? null,
      }),
    );
    // Fire-and-forget — the response returns immediately. Depth is carried
    // in-memory into the background run (not persisted — dives are one-shot).
    void this.run(job.id, normalizeDepth(rawDepth));
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

  /** Most recent completed dive for this subject within the freshness window. */
  private async recentDone(subject: string): Promise<DeepResearchJob | null> {
    try {
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
      return await this.repo
        .createQueryBuilder('j')
        .where('LOWER(j.subject) = LOWER(:subject)', { subject })
        .andWhere('j.status = :s', { s: 'done' })
        .andWhere('j.completedAt >= :cutoff', { cutoff })
        .orderBy('j.completedAt', 'DESC')
        .getOne();
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
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
    };
  }
}
