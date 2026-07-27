import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { SoldCard } from './entities/sold-card.entity';
import { TrackedCard } from './entities/tracked-card.entity';

/**
 * Ceiling on rows pulled for the realized roll-up. Well above any realistic
 * sale count for this dashboard; swap to a SQL aggregate if it's ever hit.
 */
const ROLLUP_CAP = 5000;

/** A logged sale as returned to the dashboard, with P/L already derived. */
export interface SoldCardDto {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  grade: string | null;
  quantity: number;
  /** Per-unit cost basis (what you paid), USD. */
  costBasisUsd: number | null;
  /** Per-unit gross sale price, USD. */
  salePriceUsd: number | null;
  /** Total fees on the sale (not per-unit), USD. */
  feesUsd: number | null;
  platform: string | null;
  soldAt: string | null;
  notes: string | null;
  trackedCardId: string | null;
  ownerUserId: string | null;
  createdAt: string;

  // ---- Derived (never stored, so edits stay consistent) ----
  /** salePrice x qty — gross, before fees. */
  grossProceedsUsd: number | null;
  /** grossProceeds - fees — what actually landed. */
  netProceedsUsd: number | null;
  /** costBasis x qty. */
  totalCostUsd: number | null;
  /** netProceeds - totalCost. Null when either leg is unknown. */
  realizedGainUsd: number | null;
  /** realizedGain / totalCost, percent. Null when cost is unknown or zero. */
  realizedGainPct: number | null;
}

/** Realized roll-up across every logged sale. */
export interface SoldSummary {
  sales: SoldCardDto[];
  total: number;
  /** Gross proceeds before fees. */
  totalProceedsUsd: number;
  totalFeesUsd: number;
  /** Proceeds net of fees. */
  netProceedsUsd: number;
  /** Cost basis of everything sold (only sales with a known cost). */
  totalCostUsd: number;
  realizedGainUsd: number;
  realizedGainPct: number | null;
  /** Sales rows and total copies sold — a 4-copy sale is one row. */
  saleCount: number;
  cardsSold: number;
  /** Sales missing a cost basis, so excluded from gain/loss. */
  uncostedCount: number;
  /** Best and worst flips by realized gain. */
  bestFlip: { id: string; name: string; realizedGainUsd: number } | null;
  worstFlip: { id: string; name: string; realizedGainUsd: number } | null;
}

/**
 * Sold cards — the realized half of the portfolio. Holdings track unrealized
 * gain (live value vs. cost); this tracks what you actually banked, net of
 * fees. Sales can be logged standalone or created by selling a watched card,
 * in which case the holding is drawn down by the quantity sold.
 */
@Injectable()
export class SoldCardsService {
  constructor(
    @InjectRepository(SoldCard)
    private readonly repo: Repository<SoldCard>,
    @InjectRepository(TrackedCard)
    private readonly trackedRepo: Repository<TrackedCard>,
  ) {}

  /** Round to cents — float columns otherwise leak 0.1+0.2 noise into totals. */
  private cents(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private toDto(s: SoldCard): SoldCardDto {
    const qty = s.quantity || 1;
    const gross =
      s.salePriceUsd != null ? this.cents(s.salePriceUsd * qty) : null;
    const fees = s.feesUsd ?? 0;
    const net = gross != null ? this.cents(gross - fees) : null;
    const cost =
      s.costBasisUsd != null ? this.cents(s.costBasisUsd * qty) : null;
    const gain = net != null && cost != null ? this.cents(net - cost) : null;
    return {
      id: s.id,
      name: s.name,
      brand: s.brand ?? null,
      category: s.category ?? null,
      grade: s.grade ?? null,
      quantity: qty,
      costBasisUsd: s.costBasisUsd ?? null,
      salePriceUsd: s.salePriceUsd ?? null,
      feesUsd: s.feesUsd ?? null,
      platform: s.platform ?? null,
      soldAt: s.soldAt ? s.soldAt.toISOString() : null,
      notes: s.notes ?? null,
      trackedCardId: s.trackedCardId ?? null,
      ownerUserId: s.ownerUserId ?? null,
      createdAt: s.createdAt.toISOString(),
      grossProceedsUsd: gross,
      netProceedsUsd: net,
      totalCostUsd: cost,
      realizedGainUsd: gain,
      realizedGainPct:
        gain != null && cost != null && cost > 0
          ? this.cents((gain / cost) * 100)
          : null,
    };
  }

  /** Non-negative money, or null. Sale prices of 0 are legitimate (freebies). */
  private money(v: number | null | undefined): number | null {
    if (v === null || v === undefined || (v as unknown) === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? this.cents(n) : null;
  }

  private clean(v?: string | null, max = 50): string | null {
    return (v ?? '').trim().slice(0, max) || null;
  }

  private parseDate(v?: string | null): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** List sales (most recently sold first) plus the realized roll-up. */
  async list(opts: {
    search?: string;
    limit?: number;
    offset?: number;
    ownerUserId?: string;
  }): Promise<SoldSummary> {
    const where: Record<string, unknown> = {};
    if (opts.search) where.name = ILike(`%${opts.search}%`);
    if (opts.ownerUserId) where.ownerUserId = opts.ownerUserId;
    // soldAt is nullable; NULLS LAST keeps undated sales from hogging the top.
    const order = {
      soldAt: { direction: 'DESC' as const, nulls: 'LAST' as const },
      createdAt: 'DESC' as const,
    };
    // The roll-up covers EVERY matching sale, not just the page — otherwise
    // the summary tiles would change as you "Load more".
    const [rows, total, all] = await Promise.all([
      this.repo.find({
        where,
        order,
        take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
        skip: Math.max(opts.offset ?? 0, 0),
      }),
      this.repo.count({ where }),
      this.repo.find({ where, order, take: ROLLUP_CAP }),
    ]);
    const sales = rows.map((r) => this.toDto(r));
    return {
      ...this.rollUp(all.map((r) => this.toDto(r))),
      sales,
      total,
    };
  }

  /** Roll up the realized numbers across the supplied sales. */
  private rollUp(sales: SoldCardDto[]): Omit<SoldSummary, 'sales' | 'total'> {
    let totalProceedsUsd = 0;
    let totalFeesUsd = 0;
    let totalCostUsd = 0;
    let realizedGainUsd = 0;
    let cardsSold = 0;
    let uncostedCount = 0;
    let bestFlip: SoldSummary['bestFlip'] = null;
    let worstFlip: SoldSummary['worstFlip'] = null;

    for (const s of sales) {
      cardsSold += s.quantity;
      totalProceedsUsd += s.grossProceedsUsd ?? 0;
      totalFeesUsd += s.feesUsd ?? 0;
      if (s.realizedGainUsd == null) {
        uncostedCount++;
        continue;
      }
      // Only fully-costed sales feed gain/loss, so the % stays meaningful.
      totalCostUsd += s.totalCostUsd ?? 0;
      realizedGainUsd += s.realizedGainUsd;
      if (!bestFlip || s.realizedGainUsd > bestFlip.realizedGainUsd)
        bestFlip = {
          id: s.id,
          name: s.name,
          realizedGainUsd: s.realizedGainUsd,
        };
      if (!worstFlip || s.realizedGainUsd < worstFlip.realizedGainUsd)
        worstFlip = {
          id: s.id,
          name: s.name,
          realizedGainUsd: s.realizedGainUsd,
        };
    }

    return {
      totalProceedsUsd: this.cents(totalProceedsUsd),
      totalFeesUsd: this.cents(totalFeesUsd),
      netProceedsUsd: this.cents(totalProceedsUsd - totalFeesUsd),
      totalCostUsd: this.cents(totalCostUsd),
      realizedGainUsd: this.cents(realizedGainUsd),
      realizedGainPct:
        totalCostUsd > 0
          ? this.cents((realizedGainUsd / totalCostUsd) * 100)
          : null,
      saleCount: sales.length,
      cardsSold,
      uncostedCount,
      bestFlip,
      worstFlip,
    };
  }

  /**
   * Log a sale. When `trackedCardId` is given, blank fields are inherited from
   * the watched card (name/brand/grade/cost basis) and — unless
   * `reduceHolding` is explicitly false — the holding is drawn down by the
   * quantity sold, deleting it once nothing is left.
   */
  async add(
    input: {
      name?: string;
      brand?: string;
      category?: string;
      grade?: string;
      quantity?: number;
      costBasisUsd?: number | null;
      salePriceUsd?: number | null;
      feesUsd?: number | null;
      platform?: string;
      soldAt?: string | null;
      notes?: string;
      trackedCardId?: string | null;
      reduceHolding?: boolean;
      ownerUserId?: string;
    },
    adminId?: string,
  ): Promise<SoldCardDto> {
    const tracked = input.trackedCardId
      ? await this.trackedRepo.findOne({ where: { id: input.trackedCardId } })
      : null;
    if (input.trackedCardId && !tracked)
      throw new NotFoundException('Tracked card not found');

    const name = (input.name ?? tracked?.name ?? '').trim().slice(0, 300);
    if (!name) throw new BadRequestException('A card name is required.');

    const q = Math.trunc(Number(input.quantity ?? 1));
    const quantity = Number.isFinite(q) && q > 0 ? Math.min(q, 100000) : 1;

    // Cost basis falls back to the holding's, so a flip logged off the
    // watchlist gets real P/L without re-typing what you paid.
    const costBasisUsd =
      input.costBasisUsd !== undefined
        ? this.money(input.costBasisUsd)
        : (tracked?.costBasisUsd ?? null);

    const sale = await this.repo.save(
      this.repo.create({
        name,
        brand: this.clean(input.brand ?? tracked?.brand),
        category: this.clean(input.category ?? tracked?.category),
        grade: this.clean(input.grade ?? tracked?.grade),
        quantity,
        costBasisUsd,
        salePriceUsd: this.money(input.salePriceUsd),
        feesUsd: this.money(input.feesUsd),
        platform: this.clean(input.platform, 100),
        soldAt: this.parseDate(input.soldAt) ?? new Date(),
        notes: (input.notes ?? '').trim().slice(0, 2000) || null,
        trackedCardId: tracked?.id ?? null,
        ownerUserId: input.ownerUserId ?? tracked?.ownerUserId ?? null,
        addedByAdminId: adminId ?? null,
      }),
    );

    if (tracked && input.reduceHolding !== false) {
      const left = (tracked.quantity ?? 1) - quantity;
      if (left > 0) {
        tracked.quantity = left;
        await this.trackedRepo.save(tracked);
      } else {
        await this.trackedRepo.remove(tracked);
      }
    }

    return this.toDto(sale);
  }

  /** Edit a logged sale. Omitted fields are left alone. */
  async update(
    id: string,
    input: {
      name?: string;
      brand?: string;
      category?: string;
      grade?: string;
      quantity?: number;
      costBasisUsd?: number | null;
      salePriceUsd?: number | null;
      feesUsd?: number | null;
      platform?: string;
      soldAt?: string | null;
      notes?: string;
    },
  ): Promise<SoldCardDto> {
    const sale = await this.repo.findOne({ where: { id } });
    if (!sale) throw new NotFoundException('Sale not found');

    if (input.name !== undefined) {
      const name = input.name.trim().slice(0, 300);
      if (!name) throw new BadRequestException('A card name is required.');
      sale.name = name;
    }
    if (input.brand !== undefined) sale.brand = this.clean(input.brand);
    if (input.category !== undefined)
      sale.category = this.clean(input.category);
    if (input.grade !== undefined) sale.grade = this.clean(input.grade);
    if (input.quantity !== undefined) {
      const q = Math.trunc(Number(input.quantity));
      sale.quantity = Number.isFinite(q) && q > 0 ? Math.min(q, 100000) : 1;
    }
    if (input.costBasisUsd !== undefined)
      sale.costBasisUsd = this.money(input.costBasisUsd);
    if (input.salePriceUsd !== undefined)
      sale.salePriceUsd = this.money(input.salePriceUsd);
    if (input.feesUsd !== undefined) sale.feesUsd = this.money(input.feesUsd);
    if (input.platform !== undefined)
      sale.platform = this.clean(input.platform, 100);
    if (input.soldAt !== undefined) sale.soldAt = this.parseDate(input.soldAt);
    if (input.notes !== undefined)
      sale.notes = input.notes.trim().slice(0, 2000) || null;

    await this.repo.save(sale);
    return this.toDto(sale);
  }

  /** Delete a logged sale. The holding is NOT restored — re-add it if needed. */
  async remove(id: string): Promise<{ id: string }> {
    const sale = await this.repo.findOne({ where: { id } });
    if (!sale) throw new NotFoundException('Sale not found');
    await this.repo.remove(sale);
    return { id };
  }
}
