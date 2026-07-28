import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InsightsRun } from './entities/insights-run.entity';

/**
 * A run older than this with no completion is treated as dead — the task that
 * owned it was almost certainly replaced mid-answer (deploy, scale-in, crash).
 * Without this a returning client would spin on it forever.
 */
const STALE_RUN_MS = 10 * 60 * 1000;

export interface RunDto {
  conversationId: string;
  question: string;
  status: 'running' | 'done' | 'error';
  /** Partial text while running, final text once done. */
  answer: string;
  tools: string[] | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tracks the in-flight chat turn per conversation so a client that navigates
 * away (or gets its stream cut by a proxy) can rejoin and see the answer land,
 * rather than losing work the server went on to finish anyway.
 *
 * Every write is best-effort: this is progress reporting, and it must never
 * take down the chat path it is reporting on.
 */
@Injectable()
export class InsightsRunService {
  private readonly logger = new Logger(InsightsRunService.name);

  constructor(
    @InjectRepository(InsightsRun)
    private readonly repo: Repository<InsightsRun>,
  ) {}

  /**
   * Mark a turn as started, replacing any previous run for this conversation.
   * Upsert on the unique conversationId so two rapid turns can't race a
   * duplicate row into existence.
   */
  async start(
    conversationId: string,
    question: string,
    adminId?: string,
  ): Promise<void> {
    if (!UUID_RE.test(conversationId)) return;
    try {
      await this.repo.upsert(
        {
          conversationId,
          question: (question || '').slice(0, 8000),
          status: 'running',
          answer: '',
          tools: null,
          errorMessage: null,
          startedAt: new Date(),
          finishedAt: null,
          requestedByAdminId: adminId ?? null,
        },
        ['conversationId'],
      );
    } catch (e) {
      this.logger.warn(`Run start failed: ${(e as Error).message}`);
    }
  }

  /** Store the answer so far. Called on a throttle, never per token. */
  async progress(conversationId: string, answer: string): Promise<void> {
    if (!UUID_RE.test(conversationId)) return;
    try {
      await this.repo.update(
        { conversationId, status: 'running' },
        { answer: (answer || '').slice(0, 20000) },
      );
    } catch (e) {
      this.logger.warn(`Run progress failed: ${(e as Error).message}`);
    }
  }

  /** Mark the turn complete. The exchange row is the permanent record. */
  async finish(
    conversationId: string,
    answer: string,
    tools: string[],
  ): Promise<void> {
    if (!UUID_RE.test(conversationId)) return;
    try {
      await this.repo.update(
        { conversationId },
        {
          status: 'done',
          answer: (answer || '').slice(0, 20000),
          tools: tools?.length ? tools : null,
          finishedAt: new Date(),
        },
      );
    } catch (e) {
      this.logger.warn(`Run finish failed: ${(e as Error).message}`);
    }
  }

  /** Mark the turn failed so a returning client stops waiting on it. */
  async fail(conversationId: string, message: string): Promise<void> {
    if (!UUID_RE.test(conversationId)) return;
    try {
      await this.repo.update(
        { conversationId },
        {
          status: 'error',
          errorMessage: (message || 'Something went wrong.').slice(0, 2000),
          finishedAt: new Date(),
        },
      );
    } catch (e) {
      this.logger.warn(`Run fail failed: ${(e as Error).message}`);
    }
  }

  /**
   * The current run for a conversation, or null if there was never one.
   * A 'running' row past STALE_RUN_MS is reported (and persisted) as an error
   * so an interrupted deploy can't leave a permanent spinner on the client.
   */
  async get(conversationId: string): Promise<RunDto | null> {
    if (!UUID_RE.test(conversationId)) return null;
    try {
      const run = await this.repo.findOne({ where: { conversationId } });
      if (!run) return null;

      let status = run.status as RunDto['status'];
      let errorMessage = run.errorMessage;
      if (
        status === 'running' &&
        Date.now() - run.startedAt.getTime() > STALE_RUN_MS
      ) {
        status = 'error';
        errorMessage = 'That answer was interrupted — please ask again.';
        // Persist so every later read is cheap and consistent.
        await this.repo
          .update({ conversationId }, { status, errorMessage })
          .catch(() => undefined);
      }

      return {
        conversationId: run.conversationId,
        question: run.question,
        status,
        answer: run.answer ?? '',
        tools: run.tools ?? null,
        errorMessage,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      };
    } catch (e) {
      this.logger.warn(`Run get failed: ${(e as Error).message}`);
      return null;
    }
  }
}
