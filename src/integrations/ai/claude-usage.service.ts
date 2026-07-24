import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClaudeUsageLog } from './entities/claude-usage-log.entity';

/** Which admin an operation is attributed to, and what kind of prompt it was. */
export interface AiUsageMeta {
  /** Prompt type, e.g. 'chat', 'deep_dive'. Defaults to 'other' when omitted. */
  feature?: string;
  /** Admin who triggered it; null/undefined for system/background work. */
  adminId?: string | null;
}

/** Token/search totals accumulated across every API call in one operation. */
export interface AiUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
}

/**
 * Per-1M-token pricing by model (USD). Cache reads bill at ~0.1x input, cache
 * writes at ~1.25x input. Keep in sync with platform.claude.com/pricing.
 * NOTE: claude-sonnet-5 has intro pricing ($2/$10) through 2026-08-31; we use
 * the standard $3/$15 here so cost is a conservative (slight over-) estimate.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};
/** Fallback if a model isn't in the table (use Opus rates — the priciest). */
const FALLBACK_PRICE = { in: 5, out: 25 };
/** Estimated USD per server web_search request (~$10 / 1,000). Verify on pricing page. */
const WEB_SEARCH_USD = 0.01;

/** One aggregated row of the usage table. */
export interface UsageRow {
  adminId: string | null;
  email: string | null;
  feature: string;
  prompts: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  avgTokensPerPrompt: number;
  avgCostPerPrompt: number;
}

export interface UsageSummary {
  /** Distinct users who have any usage in range — powers the user filter. */
  users: { adminId: string | null; email: string | null }[];
  /** Rows grouped by (user × prompt type) — the main table. */
  byUserAndType: UsageRow[];
  /** Rows grouped by prompt type across all users (or the filtered user). */
  byType: Omit<UsageRow, 'adminId' | 'email'>[];
  /** Overall totals (respecting the active filter). */
  totals: {
    prompts: number;
    totalTokens: number;
    costUsd: number;
  };
}

/**
 * Records Anthropic usage per operation and answers the admin Usage tab's
 * aggregate queries. Recording is best-effort — it never throws into the AI
 * path, so a logging hiccup can't break a chat or a forecast.
 */
@Injectable()
export class ClaudeUsageService {
  private readonly logger = new Logger(ClaudeUsageService.name);

  constructor(
    @InjectRepository(ClaudeUsageLog)
    private readonly repo: Repository<ClaudeUsageLog>,
  ) {}

  /** Empty accumulator for a new operation. */
  static newTotals(): AiUsageTotals {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearches: 0,
    };
  }

  /** Add one API response's `usage` into an accumulator (defensive to shape). */
  static add(acc: AiUsageTotals, usage: unknown): void {
    const u = (usage ?? {}) as Record<string, unknown>;
    const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
    acc.inputTokens += n(u.input_tokens);
    acc.outputTokens += n(u.output_tokens);
    acc.cacheReadTokens += n(u.cache_read_input_tokens);
    acc.cacheWriteTokens += n(u.cache_creation_input_tokens);
    const st = u.server_tool_use as Record<string, unknown> | undefined;
    acc.webSearches += n(st?.web_search_requests);
  }

  /** Estimated USD cost for a set of token/search totals on a given model. */
  private cost(model: string, t: AiUsageTotals): number {
    const p = PRICES[model] ?? FALLBACK_PRICE;
    const tokenCost =
      (t.inputTokens * p.in +
        t.outputTokens * p.out +
        t.cacheReadTokens * p.in * 0.1 +
        t.cacheWriteTokens * p.in * 1.25) /
      1_000_000;
    return tokenCost + t.webSearches * WEB_SEARCH_USD;
  }

  /**
   * Persist one operation's usage. Best-effort — logs and swallows any error.
   * Skips no-op rows (no tokens and no searches) to avoid noise.
   */
  async record(
    meta: AiUsageMeta | undefined,
    model: string,
    totals: AiUsageTotals,
  ): Promise<void> {
    try {
      if (
        totals.inputTokens === 0 &&
        totals.outputTokens === 0 &&
        totals.webSearches === 0
      ) {
        return;
      }
      await this.repo.save(
        this.repo.create({
          feature: meta?.feature ?? 'other',
          adminId: meta?.adminId ?? null,
          model,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          cacheReadTokens: totals.cacheReadTokens,
          cacheWriteTokens: totals.cacheWriteTokens,
          webSearches: totals.webSearches,
          costUsd: this.cost(model, totals).toFixed(6),
        }),
      );
    } catch (e) {
      this.logger.warn(`Failed to record AI usage: ${(e as Error).message}`);
    }
  }

  /**
   * Aggregate the usage log for the admin Usage tab. `days` optionally scopes
   * to the last N days (0/undefined = all time).
   */
  async summary(days = 0, userId?: string): Promise<UsageSummary> {
    // Raw SQL — avoids TypeORM query-builder ambiguity around joining the
    // unrelated `users` table. Parameterized; `where` is empty for all-time.
    const params: unknown[] = [];
    const conds: string[] = [];
    if (days > 0) {
      params.push(new Date(Date.now() - days * 86400000));
      conds.push(`l."createdAt" >= $${params.length}`);
    }
    if (userId) {
      params.push(userId);
      conds.push(`l."adminId" = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // Distinct users with usage in range (NOT filtered by userId, so the
    // dropdown always lists everyone). Null adminId = system/background work.
    const usersParams: unknown[] = [];
    let usersWhere = '';
    if (days > 0) {
      usersParams.push(new Date(Date.now() - days * 86400000));
      usersWhere = 'WHERE l."createdAt" >= $1';
    }
    const rawUsers = (await this.repo.query(
      `SELECT DISTINCT l."adminId" AS "adminId", u.email AS "email"
       FROM claude_usage_logs l
       LEFT JOIN users u ON u.id = l."adminId"
       ${usersWhere}
       ORDER BY "email" NULLS LAST`,
      usersParams,
    )) as Record<string, unknown>[];
    const users = rawUsers.map((r) => ({
      adminId: (r.adminId as string | null) ?? null,
      email: (r.email as string | null) ?? null,
    }));

    // By user × prompt type — the main table. Left-join users for the email.
    const rawRows = (await this.repo.query(
      `SELECT l."adminId" AS "adminId", u.email AS "email", l.feature AS "feature",
         COUNT(*) AS "prompts",
         COALESCE(SUM(l."inputTokens"), 0) AS "inputTokens",
         COALESCE(SUM(l."outputTokens"), 0) AS "outputTokens",
         COALESCE(SUM(l."costUsd"), 0) AS "costUsd"
       FROM claude_usage_logs l
       LEFT JOIN users u ON u.id = l."adminId"
       ${where}
       GROUP BY l."adminId", u.email, l.feature
       ORDER BY "costUsd" DESC`,
      params,
    )) as Record<string, unknown>[];

    const byUserAndType: UsageRow[] = rawRows.map((r) => this.toRow(r, true));

    // By prompt type across all users.
    const rawByType = (await this.repo.query(
      `SELECT l.feature AS "feature",
         COUNT(*) AS "prompts",
         COALESCE(SUM(l."inputTokens"), 0) AS "inputTokens",
         COALESCE(SUM(l."outputTokens"), 0) AS "outputTokens",
         COALESCE(SUM(l."costUsd"), 0) AS "costUsd"
       FROM claude_usage_logs l
       ${where}
       GROUP BY l.feature
       ORDER BY "costUsd" DESC`,
      params,
    )) as Record<string, unknown>[];

    const byType = rawByType.map((r) => {
      const row = this.toRow(r, false);
      // Strip user fields for the by-type shape.
      const { adminId: _a, email: _e, ...rest } = row;
      return rest;
    });

    const totals = byType.reduce(
      (acc, r) => {
        acc.prompts += r.prompts;
        acc.totalTokens += r.totalTokens;
        acc.costUsd += r.costUsd;
        return acc;
      },
      { prompts: 0, totalTokens: 0, costUsd: 0 },
    );

    return { users, byUserAndType, byType, totals };
  }

  /** Shape a raw aggregate row into a typed UsageRow with derived averages. */
  private toRow(
    r: Record<string, unknown>,
    withUser: boolean,
  ): UsageRow {
    const num = (v: unknown): number => Number(v ?? 0) || 0;
    const prompts = num(r.prompts);
    const inputTokens = num(r.inputTokens);
    const outputTokens = num(r.outputTokens);
    const totalTokens = inputTokens + outputTokens;
    const costUsd = num(r.costUsd);
    return {
      adminId: withUser ? ((r.adminId as string | null) ?? null) : null,
      email: withUser ? ((r.email as string | null) ?? null) : null,
      feature: String(r.feature ?? 'other'),
      prompts,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      avgTokensPerPrompt: prompts > 0 ? Math.round(totalTokens / prompts) : 0,
      avgCostPerPrompt: prompts > 0 ? costUsd / prompts : 0,
    };
  }
}
