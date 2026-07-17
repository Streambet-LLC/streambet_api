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
import { AiService } from '../integrations/ai/ai.service';

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

  async start(subject: string, adminId?: string): Promise<DeepResearchJobDto> {
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
    // Fire-and-forget — the response returns immediately.
    void this.run(job.id);
    return this.toDto(job);
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

  private async run(id: string): Promise<void> {
    try {
      await this.repo.update(id, { status: 'running', startedAt: new Date() });
      const job = await this.repo.findOne({ where: { id } });
      if (!job) return;
      const result = await this.forecast.researchSubject(job.subject);
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
