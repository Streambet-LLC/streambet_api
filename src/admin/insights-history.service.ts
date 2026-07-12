import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InsightsExchange } from './entities/insights-exchange.entity';

export interface ConversationSummary {
  conversationId: string;
  title: string;
  count: number;
  startedAt: string;
  lastAt: string;
}

export interface ExchangeDto {
  id: string;
  question: string;
  answer: string;
  tools: string[] | null;
  createdAt: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Persists and browses Insights chat history. One row per question→answer
 * exchange; grouped into conversations by `conversationId`. All reads degrade
 * to empty if the table isn't migrated yet (avoids 500s).
 */
@Injectable()
export class InsightsHistoryService {
  private readonly logger = new Logger(InsightsHistoryService.name);

  constructor(
    @InjectRepository(InsightsExchange)
    private readonly repo: Repository<InsightsExchange>,
  ) {}

  /** Best-effort save — never throws into the chat response path. */
  async save(entry: {
    conversationId: string;
    question: string;
    answer: string;
    tools: string[];
    adminId?: string;
  }): Promise<void> {
    if (!UUID_RE.test(entry.conversationId)) return;
    if (!entry.question?.trim() || !entry.answer?.trim()) return;
    try {
      await this.repo.save(
        this.repo.create({
          conversationId: entry.conversationId,
          question: entry.question.slice(0, 8000),
          answer: entry.answer.slice(0, 20000),
          tools: entry.tools?.length ? entry.tools : null,
          requestedByAdminId: entry.adminId ?? null,
        }),
      );
    } catch (e) {
      this.logger.warn(`History save failed: ${(e as Error).message}`);
    }
  }

  async listConversations(
    limit = 20,
    offset = 0,
  ): Promise<{ total: number; data: ConversationSummary[] }> {
    const lim = Math.min(Math.max(limit, 1), 50);
    const off = Math.max(offset, 0);
    try {
      const totalRows = (await this.repo.manager.query(
        `SELECT count(DISTINCT "conversationId")::int AS n FROM insights_exchanges`,
      )) as { n: number }[];
      const total = totalRows[0]?.n ?? 0;

      const rows = (await this.repo.manager.query(
        `SELECT sub.cid, sub.n, sub.started, sub.last_at, e.question AS title
         FROM (
           SELECT "conversationId" AS cid, count(*)::int AS n,
                  min("createdAt") AS started, max("createdAt") AS last_at
           FROM insights_exchanges
           GROUP BY "conversationId"
           ORDER BY max("createdAt") DESC
           LIMIT $1 OFFSET $2
         ) sub
         JOIN LATERAL (
           SELECT question FROM insights_exchanges e2
           WHERE e2."conversationId" = sub.cid
           ORDER BY e2."createdAt" ASC LIMIT 1
         ) e ON true
         ORDER BY sub.last_at DESC`,
        [lim, off],
      )) as {
        cid: string;
        n: number;
        started: Date;
        last_at: Date;
        title: string;
      }[];

      return {
        total,
        data: rows.map((r) => ({
          conversationId: r.cid,
          title: r.title,
          count: r.n,
          startedAt: new Date(r.started).toISOString(),
          lastAt: new Date(r.last_at).toISOString(),
        })),
      };
    } catch (e) {
      this.logger.warn(`History list failed: ${(e as Error).message}`);
      return { total: 0, data: [] };
    }
  }

  async getConversation(conversationId: string): Promise<ExchangeDto[]> {
    if (!UUID_RE.test(conversationId)) return [];
    try {
      const rows = await this.repo.find({
        where: { conversationId },
        order: { createdAt: 'ASC' },
        take: 200,
      });
      return rows.map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        tools: r.tools,
        createdAt: r.createdAt.toISOString(),
      }));
    } catch (e) {
      this.logger.warn(`History get failed: ${(e as Error).message}`);
      return [];
    }
  }
}
