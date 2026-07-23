import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { TrackedCard } from './entities/tracked-card.entity';

/** A tracked card as returned to the dashboard. */
export interface TrackedCardDto {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  grade: string | null;
  notes: string | null;
  ownerUserId: string | null;
  createdAt: string;
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
  ) {}

  private toDto(c: TrackedCard): TrackedCardDto {
    return {
      id: c.id,
      name: c.name,
      brand: c.brand ?? null,
      category: c.category ?? null,
      grade: c.grade ?? null,
      notes: c.notes ?? null,
      ownerUserId: c.ownerUserId ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  /** List tracked cards, newest first, with optional name search. */
  async listCards(opts: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; data: TrackedCardDto[] }> {
    const [rows, total] = await this.repo.findAndCount({
      where: opts.search ? { name: ILike(`%${opts.search}%`) } : {},
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
}
