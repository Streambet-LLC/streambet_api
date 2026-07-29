import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserComp } from '../entities/user-comp.entity';
import { ValComp } from './valuation.util';

/** Normalized subject key — must match the valuation cache key exactly. */
export const compKey = (subject: string): string =>
  (subject ?? '').trim().toLowerCase().slice(0, 300);

export interface UserCompDto {
  id: string;
  subject: string;
  title: string | null;
  priceUsd: number;
  saleDate: string | null;
  grade: string | null;
  sourceType: string;
  url: string;
  note: string | null;
  verified: boolean;
  createdAt: string;
}

/**
 * Sales the user supplied because our retrieval couldn't see them.
 *
 * The valuation engine only reads sources it knows how to reach. A sale on
 * Goldin, Heritage, Fanatics or done privately is invisible to it, and the
 * person holding the card usually knows about those. This service is the
 * memory for that: supply a comp once and every later valuation of the same
 * card includes it.
 */
@Injectable()
export class UserCompsService {
  private readonly logger = new Logger(UserCompsService.name);

  constructor(
    @InjectRepository(UserComp)
    private readonly repo: Repository<UserComp>,
  ) {}

  /**
   * Record a sale the user pointed us at.
   *
   * We take them at their word on the numbers but REQUIRE a url — a comp
   * without a source is a rumour, and the whole valuation contract is that
   * every price traces to something you can open. It is stored unverified and
   * labelled as user-supplied so it can never pass as retrieved evidence.
   */
  async add(
    input: {
      subject: string;
      url: string;
      priceUsd: number;
      saleDate?: string | null;
      title?: string | null;
      grade?: string | null;
      sourceType?: string | null;
      note?: string | null;
    },
    adminId?: string,
  ): Promise<UserCompDto> {
    const subject = compKey(input.subject);
    if (!subject) throw new BadRequestException('A card subject is required.');

    const url = (input.url ?? '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      throw new BadRequestException(
        'A link to the sale is required so the price can be checked.',
      );
    }

    const priceUsd = Number(input.priceUsd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      throw new BadRequestException('A sale price is required.');
    }

    // Normalize the date to YYYY-MM-DD; anything unparseable is dropped rather
    // than guessed, since a wrong date would corrupt the anchor.
    let saleDate: string | null = null;
    if (input.saleDate) {
      const d = new Date(input.saleDate);
      if (!Number.isNaN(d.getTime())) saleDate = d.toISOString().slice(0, 10);
    }

    // Same sale supplied twice (same url + price) — update rather than stack.
    const existing = await this.repo.findOne({ where: { subject, url } });
    const row = existing ?? this.repo.create({ subject, url });
    row.priceUsd = Math.round(priceUsd * 100) / 100;
    row.saleDate = saleDate;
    row.title = (input.title ?? '').trim().slice(0, 500) || null;
    row.grade = (input.grade ?? '').trim().slice(0, 50) || null;
    row.sourceType =
      (input.sourceType ?? '').trim().toLowerCase() || 'auction-sale';
    row.note = (input.note ?? '').trim().slice(0, 1000) || null;
    row.addedByAdminId = adminId ?? row.addedByAdminId ?? null;
    const saved = await this.repo.save(row);
    return this.toDto(saved);
  }

  /** Every user-supplied comp for a card, as ValComps ready to merge. */
  async compsFor(subject: string): Promise<ValComp[]> {
    const key = compKey(subject);
    if (!key) return [];
    try {
      const rows = await this.repo.find({
        where: { subject: key },
        order: { saleDate: 'DESC' },
        take: 20,
      });
      return rows.map((r) => ({
        priceUsd: r.priceUsd,
        date: r.saleDate,
        grade: r.grade,
        title: r.title,
        sourceType: r.sourceType,
        url: r.url,
        userSupplied: true,
      }));
    } catch (e) {
      // Never let this break a valuation — it is additive evidence.
      this.logger.warn(`user comps lookup failed: ${(e as Error).message}`);
      return [];
    }
  }

  async list(subject: string): Promise<UserCompDto[]> {
    const rows = await this.repo.find({
      where: { subject: compKey(subject) },
      order: { saleDate: 'DESC' },
      take: 50,
    });
    return rows.map((r) => this.toDto(r));
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.repo.delete(id);
    return { id };
  }

  private toDto(r: UserComp): UserCompDto {
    return {
      id: r.id,
      subject: r.subject,
      title: r.title,
      priceUsd: r.priceUsd,
      saleDate: r.saleDate,
      grade: r.grade,
      sourceType: r.sourceType,
      url: r.url,
      note: r.note,
      verified: r.verified,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
