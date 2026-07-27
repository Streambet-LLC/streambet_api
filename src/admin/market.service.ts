import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { TrackedCard } from './entities/tracked-card.entity';
import {
  ValuationService,
  CardValuation,
} from './card-market/valuation.service';

/** A tracked card / portfolio holding as returned to the dashboard. */
export interface TrackedCardDto {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  grade: string | null;
  notes: string | null;
  /** Portfolio: copies held. */
  quantity: number;
  /** Portfolio: per-unit cost basis (what you paid), USD. */
  costBasisUsd: number | null;
  acquiredAt: string | null;
  /** Cached latest per-unit market value. */
  lastValueUsd: number | null;
  lastConfidencePct: number | null;
  lastValuedAt: string | null;
  /** Full latest valuation snapshot (for the card display). */
  lastValuation: CardValuation | null;
  /** Price-alert targets. */
  alertAboveUsd: number | null;
  alertBelowUsd: number | null;
  ownerUserId: string | null;
  createdAt: string;
}

/** A triggered price alert for a holding. */
export interface PortfolioAlert {
  id: string;
  name: string;
  type: 'target-above' | 'target-below' | 'move';
  direction: 'up' | 'down';
  message: string;
  valueUsd: number;
  changePct: number | null;
}

/** Portfolio roll-up across all holdings. */
export interface PortfolioSummary {
  cards: TrackedCardDto[];
  totalValueUsd: number;
  totalCostUsd: number;
  gainUsd: number;
  gainPct: number | null;
  /** Holdings with a recorded cost basis (counted in gain/loss). */
  costedCount: number;
  valuedCount: number;
  cardCount: number;
  /** Biggest per-unit % movers (needs both cost + value), best first. */
  movers: {
    id: string;
    name: string;
    changePct: number;
    valueUsd: number;
  }[];
}

/** Minimal card reference used by forecast/market-profile research prompts. */
export interface CardRefDto {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  grade: string | null;
}

/**
 * Tracked-cards service — the card-research universe for the analytics
 * dashboard. This replaced the marketplace catalog integration: cards are now
 * explicitly tracked (by admins today; saved to user profiles once sign-ups
 * reopen), and all enrichment is EXTERNAL market data (web research, eBay,
 * forecasts) — no marketplace sales/buyer metrics.
 */
@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(TrackedCard)
    private readonly repo: Repository<TrackedCard>,
    private readonly valuation: ValuationService,
  ) {}

  private toDto(c: TrackedCard): TrackedCardDto {
    return {
      id: c.id,
      name: c.name,
      brand: c.brand ?? null,
      category: c.category ?? null,
      grade: c.grade ?? null,
      notes: c.notes ?? null,
      quantity: c.quantity ?? 1,
      costBasisUsd: c.costBasisUsd ?? null,
      acquiredAt: c.acquiredAt ? c.acquiredAt.toISOString() : null,
      lastValueUsd: c.lastValueUsd ?? null,
      lastConfidencePct: c.lastConfidencePct ?? null,
      lastValuedAt: c.lastValuedAt ? c.lastValuedAt.toISOString() : null,
      lastValuation: (c.lastValuation as unknown as CardValuation) ?? null,
      alertAboveUsd: c.alertAboveUsd ?? null,
      alertBelowUsd: c.alertBelowUsd ?? null,
      ownerUserId: c.ownerUserId ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  /** The search subject for valuing a tracked card. */
  private subjectFor(c: {
    name: string;
    brand?: string | null;
    grade?: string | null;
  }): string {
    return [c.name, c.grade].filter(Boolean).join(' ').trim();
  }

  /** List tracked cards, newest first, with optional name search + owner. */
  async listCards(opts: {
    search?: string;
    limit?: number;
    offset?: number;
    ownerUserId?: string;
  }): Promise<{ total: number; data: TrackedCardDto[] }> {
    const where: Record<string, unknown> = {};
    if (opts.search) where.name = ILike(`%${opts.search}%`);
    if (opts.ownerUserId) where.ownerUserId = opts.ownerUserId;
    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
      skip: Math.max(opts.offset ?? 0, 0),
    });
    return { total, data: rows.map((r) => this.toDto(r)) };
  }

  /** One tracked card by id. */
  async getCard(id: string): Promise<TrackedCardDto> {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Tracked card not found');
    return this.toDto(card);
  }

  /**
   * Minimal reference for research prompts (forecasts, market profiles).
   * Same shape the old catalog lookup produced — id + display fields only.
   */
  async getCardRef(id: string): Promise<CardRefDto> {
    const c = await this.getCard(id);
    return {
      id: c.id,
      name: c.name,
      brand: c.brand,
      category: c.category,
      grade: c.grade,
    };
  }

  /** Track a new card. */
  async addCard(
    input: {
      name?: string;
      brand?: string;
      category?: string;
      grade?: string;
      notes?: string;
      ownerUserId?: string;
    },
    adminId?: string,
  ): Promise<TrackedCardDto> {
    const name = (input.name ?? '').trim().slice(0, 300);
    if (!name) throw new BadRequestException('A card name is required.');
    const clean = (v?: string, max = 50) =>
      (v ?? '').trim().slice(0, max) || null;
    const card = await this.repo.save(
      this.repo.create({
        name,
        brand: clean(input.brand),
        category: clean(input.category),
        grade: clean(input.grade),
        notes: (input.notes ?? '').trim().slice(0, 2000) || null,
        ownerUserId: input.ownerUserId ?? null,
        addedByAdminId: adminId ?? null,
      }),
    );
    return this.toDto(card);
  }

  /** Stop tracking a card. (Forecast/profile history rows are left in place.) */
  async removeCard(id: string): Promise<{ id: string }> {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Tracked card not found');
    await this.repo.remove(card);
    return { id };
  }

  /** Update a holding's cost basis / quantity / acquired date. */
  async updateHolding(
    id: string,
    input: {
      quantity?: number;
      costBasisUsd?: number | null;
      acquiredAt?: string | null;
      alertAboveUsd?: number | null;
      alertBelowUsd?: number | null;
    },
  ): Promise<TrackedCardDto> {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Tracked card not found');
    if (input.quantity != null) {
      const q = Math.trunc(Number(input.quantity));
      card.quantity = Number.isFinite(q) && q > 0 ? Math.min(q, 100000) : 1;
    }
    if (input.costBasisUsd !== undefined) {
      const c = Number(input.costBasisUsd);
      card.costBasisUsd =
        input.costBasisUsd === null || !Number.isFinite(c) || c < 0 ? null : c;
    }
    if (input.acquiredAt !== undefined) {
      const d = input.acquiredAt ? new Date(input.acquiredAt) : null;
      card.acquiredAt = d && !Number.isNaN(d.getTime()) ? d : null;
    }
    const money = (v: number | null | undefined) => {
      if (v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    if (input.alertAboveUsd !== undefined)
      card.alertAboveUsd = money(input.alertAboveUsd);
    if (input.alertBelowUsd !== undefined)
      card.alertBelowUsd = money(input.alertBelowUsd);
    await this.repo.save(card);
    return this.toDto(card);
  }

  /**
   * Triggered price alerts across holdings: a value crossing a user target,
   * and any big move (>=8%) since the previous logged valuation. Powers the
   * portfolio's "what moved" banner — the retention hook.
   */
  async alerts(ownerUserId?: string): Promise<PortfolioAlert[]> {
    const { data } = await this.listCards({ ownerUserId, limit: 200 });
    const out: PortfolioAlert[] = [];
    const MOVE_THRESHOLD = 8; // percent
    for (const c of data) {
      const v = c.lastValueUsd;
      if (v == null) continue;
      // Target crossings.
      if (c.alertAboveUsd != null && v >= c.alertAboveUsd) {
        out.push({
          id: c.id,
          name: c.name,
          type: 'target-above',
          direction: 'up',
          message: `crossed your $${Math.round(c.alertAboveUsd).toLocaleString('en-US')} target (now $${Math.round(v).toLocaleString('en-US')})`,
          valueUsd: v,
          changePct: null,
        });
      }
      if (c.alertBelowUsd != null && v <= c.alertBelowUsd) {
        out.push({
          id: c.id,
          name: c.name,
          type: 'target-below',
          direction: 'down',
          message: `fell below your $${Math.round(c.alertBelowUsd).toLocaleString('en-US')} floor (now $${Math.round(v).toLocaleString('en-US')})`,
          valueUsd: v,
          changePct: null,
        });
      }
      // Movement vs. the previous logged valuation.
      try {
        const hist = await this.valuation.history(this.subjectFor(c), 2);
        if (hist.length >= 2) {
          const prev = hist[hist.length - 2].pointUsd;
          const cur = hist[hist.length - 1].pointUsd;
          if (prev != null && cur != null && prev > 0) {
            const changePct = ((cur - prev) / prev) * 100;
            if (Math.abs(changePct) >= MOVE_THRESHOLD) {
              out.push({
                id: c.id,
                name: c.name,
                type: 'move',
                direction: changePct >= 0 ? 'up' : 'down',
                message: `${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(0)}% since your last check (now $${Math.round(cur).toLocaleString('en-US')})`,
                valueUsd: cur,
                changePct,
              });
            }
          }
        }
      } catch {
        /* history is best-effort */
      }
    }
    // Biggest moves first, targets before moves.
    return out.sort((a, b) => Math.abs(b.changePct ?? 999) - Math.abs(a.changePct ?? 999));
  }

  /**
   * Value ONE tracked card (code-computed comps) and cache the result on the
   * row so the portfolio view stays fast.
   */
  async valueCard(id: string, adminId?: string): Promise<TrackedCardDto> {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Tracked card not found');
    const v = await this.valuation.valueCard(this.subjectFor(card), adminId);
    card.lastValueUsd = v.pointUsd;
    card.lastConfidencePct = v.confidencePct;
    card.lastValuedAt = new Date();
    card.lastValuation = v as unknown as Record<string, unknown>;
    await this.repo.save(card);
    return this.toDto(card);
  }

  /** Value EVERY holding (bounded concurrency), then return the roll-up. */
  async valuePortfolio(
    adminId?: string,
    ownerUserId?: string,
  ): Promise<PortfolioSummary> {
    const { data } = await this.listCards({ ownerUserId, limit: 200 });
    const ids = data.map((c) => c.id);
    // Bounded parallelism so we don't hammer the AI / rate limits.
    const CONCURRENCY = 3;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      await Promise.all(
        ids.slice(i, i + CONCURRENCY).map((id) =>
          this.valueCard(id, adminId).catch(() => null),
        ),
      );
    }
    return this.portfolio(ownerUserId);
  }

  /** Pre-warm the valuation cache (showcase set by default) for a live demo. */
  async warmValuations(subjects?: string[], adminId?: string) {
    return this.valuation.warm(subjects, adminId);
  }

  /** Our logged price history for a card subject (data moat). */
  async valuationHistory(subject: string) {
    return this.valuation.history(subject);
  }

  /** Portfolio roll-up from the cached per-card valuations. */
  async portfolio(ownerUserId?: string): Promise<PortfolioSummary> {
    const { data } = await this.listCards({ ownerUserId, limit: 200 });
    let totalValueUsd = 0;
    let totalCostUsd = 0;
    let costedCount = 0;
    let valuedCount = 0;
    const movers: PortfolioSummary['movers'] = [];
    for (const c of data) {
      const qty = c.quantity || 1;
      if (c.lastValueUsd != null) {
        totalValueUsd += c.lastValueUsd * qty;
        valuedCount++;
      }
      if (c.costBasisUsd != null) {
        totalCostUsd += c.costBasisUsd * qty;
        costedCount++;
        if (c.lastValueUsd != null && c.costBasisUsd > 0) {
          movers.push({
            id: c.id,
            name: c.name,
            changePct:
              ((c.lastValueUsd - c.costBasisUsd) / c.costBasisUsd) * 100,
            valueUsd: c.lastValueUsd * qty,
          });
        }
      }
    }
    const gainUsd = totalValueUsd - totalCostUsd;
    movers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    return {
      cards: data,
      totalValueUsd: Math.round(totalValueUsd * 100) / 100,
      totalCostUsd: Math.round(totalCostUsd * 100) / 100,
      gainUsd: Math.round(gainUsd * 100) / 100,
      gainPct: totalCostUsd > 0 ? (gainUsd / totalCostUsd) * 100 : null,
      costedCount,
      valuedCount,
      cardCount: data.length,
      movers: movers.slice(0, 5),
    };
  }
}
