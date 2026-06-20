import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SellerInventoryUpload } from './entities/seller-inventory-upload.entity';
import { SellerInventoryItem } from './entities/seller-inventory-item.entity';
import { IngestSellerInventoryDto } from './dto/seller-inventory.dto';
import { deriveBuyerVolume } from './buyer-volume.util';
import { deriveMetroArea } from './metro-area.util';

const PAID_STATUSES_SQL =
  "('paid','shipped','delivered','payment_processing')";

/**
 * Normalize a product/card name for fuzzy matching: lowercase, strip
 * punctuation, collapse whitespace. "Charizard #4 (PSA 10)!" → "charizard 4 psa 10".
 */
export const normalizeProductName = (raw: string | null | undefined): string =>
  (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (norm: string): Set<string> =>
  new Set(norm.split(' ').filter((t) => t.length > 1));

/** A CardCade product that has actually sold (a match candidate). */
interface SoldProduct {
  id: string;
  name: string;
  brand: string | null;
  norm: string;
  tokens: Set<string>;
}

/** A buyer matched to one or more inventory items. */
export interface MatchedBuyer {
  userId: string;
  username: string;
  name: string | null;
  email: string;
  lifetimeSpendUsd: number;
  volume: 'High' | 'Medium' | 'Low' | null;
  location: string | null;
  unitsBought: number;
  matchedProductIds: string[];
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

@Injectable()
export class SellerInventoryService {
  constructor(
    @InjectRepository(SellerInventoryUpload)
    private readonly uploadRepo: Repository<SellerInventoryUpload>,
    @InjectRepository(SellerInventoryItem)
    private readonly itemRepo: Repository<SellerInventoryItem>,
    private readonly dataSource: DataSource,
  ) {}

  private async rawQuery<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const rows: unknown = await this.dataSource.query(sql, params);
    return (rows ?? []) as T[];
  }

  /** All distinct products that have sold on CardCade, for matching. */
  private async loadSoldProducts(): Promise<SoldProduct[]> {
    const rows = await this.rawQuery<{
      id: string;
      name: string;
      brand: string | null;
    }>(
      `SELECT p.id AS id, p.name AS name, p.brand AS brand
       FROM prize_configurations p
       JOIN prize_orders o ON o.prize_configuration_id = p.id
       WHERE o.status IN ${PAID_STATUSES_SQL}
       GROUP BY p.id, p.name, p.brand`,
    );
    return rows.map((r) => {
      const norm = normalizeProductName(r.name);
      return { ...r, norm, tokens: tokenize(norm) };
    });
  }

  /**
   * Fuzzy-match an item's normalized name against the sold-product catalog.
   * Tiers, strongest first: exact normalized equality → substring containment
   * (with a length guard) → token Jaccard overlap ≥ 0.6.
   */
  private matchProductIds(itemNorm: string, catalog: SoldProduct[]): string[] {
    if (!itemNorm) return [];
    const itemTokens = tokenize(itemNorm);

    const exact = catalog.filter((p) => p.norm === itemNorm);
    if (exact.length) return exact.map((p) => p.id);

    const matches = new Set<string>();
    for (const p of catalog) {
      if (!p.norm) continue;
      // Containment either direction, but require ≥4 chars to avoid noise.
      if (
        itemNorm.length >= 4 &&
        (p.norm.includes(itemNorm) || itemNorm.includes(p.norm))
      ) {
        matches.add(p.id);
        continue;
      }
      // Token overlap (Jaccard) for reordered / partial names.
      if (itemTokens.size && p.tokens.size) {
        let inter = 0;
        for (const t of itemTokens) if (p.tokens.has(t)) inter++;
        const union = itemTokens.size + p.tokens.size - inter;
        if (union > 0 && inter / union >= 0.6) matches.add(p.id);
      }
    }
    return [...matches];
  }

  /**
   * Buyers for a set of prize_configuration ids, with spend + identity so the
   * UI can show who to reach. Keyed by userId with the products they bought.
   */
  private async loadBuyersForProducts(
    productIds: string[],
  ): Promise<Map<string, MatchedBuyer>> {
    const out = new Map<string, MatchedBuyer>();
    if (productIds.length === 0) return out;

    const rows = await this.rawQuery<{
      user_id: string;
      product_id: string;
      username: string | null;
      name: string | null;
      email: string | null;
      city: string | null;
      state: string | null;
      zip_code: string | null;
      country: string | null;
      units: number | string;
      lifetime: number | string;
    }>(
      `SELECT o.user_id AS user_id,
              o.prize_configuration_id AS product_id,
              u.username AS username,
              u.name AS name,
              u.email AS email,
              u.city AS city,
              u.state AS state,
              u.zip_code AS zip_code,
              u.country AS country,
              COUNT(*)::int AS units,
              COALESCE(life.lifetime, 0)::float AS lifetime
       FROM prize_orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN (
         SELECT user_id, SUM(total_price) AS lifetime
         FROM prize_orders
         WHERE status IN ${PAID_STATUSES_SQL}
         GROUP BY user_id
       ) life ON life.user_id = o.user_id
       WHERE o.prize_configuration_id = ANY($1)
         AND o.status IN ${PAID_STATUSES_SQL}
       GROUP BY o.user_id, o.prize_configuration_id, u.username, u.name,
                u.email, u.city, u.state, u.zip_code, u.country, life.lifetime`,
      [productIds],
    );

    for (const r of rows) {
      const existing = out.get(r.user_id);
      if (existing) {
        existing.unitsBought += num(r.units);
        if (!existing.matchedProductIds.includes(r.product_id)) {
          existing.matchedProductIds.push(r.product_id);
        }
        continue;
      }
      const lifetime = num(r.lifetime);
      out.set(r.user_id, {
        userId: r.user_id,
        username: r.username ?? '',
        name: r.name,
        email: r.email ?? '',
        lifetimeSpendUsd: lifetime,
        volume: deriveBuyerVolume(lifetime),
        location: deriveMetroArea({
          city: r.city,
          state: r.state,
          zip: r.zip_code,
          country: r.country,
        }),
        unitsBought: num(r.units),
        matchedProductIds: [r.product_id],
      });
    }
    return out;
  }

  /**
   * Ingest an upload: persist the batch + rows, match each row to buyers, and
   * snapshot the counts. Returns the full detail (rows + matched buyers).
   */
  async ingest(dto: IngestSellerInventoryDto, adminId?: string) {
    const catalog = await this.loadSoldProducts();

    const upload = this.uploadRepo.create({
      sellerUserId: dto.sellerUserId ?? null,
      sellerLabel: dto.sellerLabel ?? null,
      source: dto.source,
      fileName: dto.fileName ?? null,
      rowCount: dto.items.length,
      createdByAdminId: adminId ?? null,
      matchedItemCount: 0,
      matchedBuyerCount: 0,
    });
    await this.uploadRepo.save(upload);

    const allMatchedProductIds = new Set<string>();
    const items: SellerInventoryItem[] = dto.items.map((it, idx) => {
      const norm = normalizeProductName(it.productName);
      const matchedProductIds = this.matchProductIds(norm, catalog);
      matchedProductIds.forEach((id) => allMatchedProductIds.add(id));
      return this.itemRepo.create({
        uploadId: upload.id,
        rowIndex: idx,
        productName: it.productName,
        normalizedName: norm,
        sku: it.sku ?? null,
        setName: it.setName ?? null,
        condition: it.condition ?? null,
        grade: it.grade ?? null,
        quantity: it.quantity ?? null,
        priceUsd: it.priceUsd != null ? String(it.priceUsd) : null,
        raw: it.raw ?? null,
        matchedProductIds: matchedProductIds.length ? matchedProductIds : null,
        matchedBuyerCount: 0,
      });
    });

    // Resolve buyers once for the whole upload, then fan out per item.
    const buyersByProduct = await this.loadBuyersForProducts([
      ...allMatchedProductIds,
    ]);

    let matchedItemCount = 0;
    const distinctBuyers = new Set<string>();
    for (const item of items) {
      const ids = item.matchedProductIds ?? [];
      const buyerIds = new Set<string>();
      for (const [userId, buyer] of buyersByProduct) {
        if (buyer.matchedProductIds.some((pid) => ids.includes(pid))) {
          buyerIds.add(userId);
          distinctBuyers.add(userId);
        }
      }
      item.matchedBuyerCount = buyerIds.size;
      if (buyerIds.size > 0) matchedItemCount++;
    }
    await this.itemRepo.save(items);

    upload.matchedItemCount = matchedItemCount;
    upload.matchedBuyerCount = distinctBuyers.size;
    await this.uploadRepo.save(upload);

    return this.getUploadDetail(upload.id);
  }

  /** All ingest batches, newest first, with snapshot counts. */
  async listUploads() {
    const uploads = await this.uploadRepo.find({
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return uploads.map((u) => ({
      id: u.id,
      sellerUserId: u.sellerUserId,
      sellerLabel: u.sellerLabel,
      source: u.source,
      fileName: u.fileName,
      rowCount: u.rowCount,
      matchedItemCount: u.matchedItemCount,
      matchedBuyerCount: u.matchedBuyerCount,
      createdAt: u.createdAt,
    }));
  }

  /**
   * Full detail for one upload: each item with its matched buyers (recomputed
   * live so spend/identity stays fresh) plus a de-duplicated buyer roster.
   */
  async getUploadDetail(id: string) {
    const upload = await this.uploadRepo.findOne({ where: { id } });
    if (!upload) throw new NotFoundException('Upload not found');
    const items = await this.itemRepo.find({
      where: { uploadId: id },
      order: { rowIndex: 'ASC' },
    });

    const allProductIds = new Set<string>();
    items.forEach((it) =>
      (it.matchedProductIds ?? []).forEach((pid) => allProductIds.add(pid)),
    );
    const buyersByProduct = await this.loadBuyersForProducts([...allProductIds]);

    const rosterMap = new Map<string, MatchedBuyer & { matchedItems: number }>();

    const itemDtos = items.map((it) => {
      const ids = it.matchedProductIds ?? [];
      const buyers: MatchedBuyer[] = [];
      for (const buyer of buyersByProduct.values()) {
        if (buyer.matchedProductIds.some((pid) => ids.includes(pid))) {
          buyers.push(buyer);
          const r = rosterMap.get(buyer.userId);
          if (r) {
            r.matchedItems += 1;
          } else {
            rosterMap.set(buyer.userId, { ...buyer, matchedItems: 1 });
          }
        }
      }
      buyers.sort((a, b) => b.lifetimeSpendUsd - a.lifetimeSpendUsd);
      return {
        id: it.id,
        rowIndex: it.rowIndex,
        productName: it.productName,
        sku: it.sku,
        setName: it.setName,
        condition: it.condition,
        grade: it.grade,
        quantity: it.quantity,
        priceUsd: it.priceUsd != null ? num(it.priceUsd) : null,
        matchedBuyerCount: buyers.length,
        buyers,
      };
    });

    const roster = [...rosterMap.values()].sort(
      (a, b) => b.lifetimeSpendUsd - a.lifetimeSpendUsd,
    );

    return {
      id: upload.id,
      sellerUserId: upload.sellerUserId,
      sellerLabel: upload.sellerLabel,
      source: upload.source,
      fileName: upload.fileName,
      rowCount: upload.rowCount,
      matchedItemCount: upload.matchedItemCount,
      matchedBuyerCount: roster.length,
      createdAt: upload.createdAt,
      items: itemDtos,
      buyers: roster,
    };
  }

  async deleteUpload(id: string): Promise<void> {
    const upload = await this.uploadRepo.findOne({ where: { id } });
    if (!upload) throw new NotFoundException('Upload not found');
    await this.uploadRepo.remove(upload);
  }
}
