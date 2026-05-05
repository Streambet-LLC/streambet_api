import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { PrizeConfiguration } from 'src/prize/entities/prize-configuration.entity';
import { PrizeItemEbaySoldListing } from 'src/prize/entities/prize-item-ebay-sold-listing.entity';
import { PrizeItemEbaySyncState } from 'src/prize/entities/prize-item-ebay-sync-state.entity';
import {
  EbayCompletedItem,
  EbayCompletedItemsResult,
  EbayService,
} from 'src/integrations/ebay/ebay.service';
import { normalizeEbaySearchKeywords } from 'src/integrations/ebay/ebay-query.utils';

const SYNC_BATCH_SIZE = 6;
const DEFAULT_MAX_SEARCH_RESULTS: 60 | 120 | 240 = 240;
const MAX_RETRY_ATTEMPTS = 3;
const SYNC_ALL_DELAY_MS = 4000;

@Injectable()
export class EbaySoldMarketSyncService {
  private readonly logger = new Logger(EbaySoldMarketSyncService.name);

  constructor(
    @InjectRepository(PrizeConfiguration)
    private readonly itemRepository: Repository<PrizeConfiguration>,
    @InjectRepository(PrizeItemEbaySoldListing)
    private readonly soldListingRepository: Repository<PrizeItemEbaySoldListing>,
    @InjectRepository(PrizeItemEbaySyncState)
    private readonly syncStateRepository: Repository<PrizeItemEbaySyncState>,
    private readonly ebayService: EbayService,
  ) {}

  private isSyncAllRunning = false;

  async startSyncAll(): Promise<{
    alreadyRunning: boolean;
    queued: number;
    itemIds: string[];
  }> {
    if (this.isSyncAllRunning) {
      return { alreadyRunning: true, queued: 0, itemIds: [] };
    }

    const items = await this.itemRepository.find({
      where: { isActive: true },
      select: ['id'],
      order: { name: 'ASC' },
    });

    if (items.length === 0) {
      return { alreadyRunning: false, queued: 0, itemIds: [] };
    }

    this.isSyncAllRunning = true;
    const itemIds = items.map((i) => i.id);

    void this.runSyncAllBackground(itemIds);

    return { alreadyRunning: false, queued: itemIds.length, itemIds };
  }

  private async runSyncAllBackground(itemIds: string[]): Promise<void> {
    this.logger.log(`eBay sync-all started: ${itemIds.length} items`);

    for (let i = 0; i < itemIds.length; i++) {
      try {
        const result = await this.runManualSyncForItem(itemIds[i]);
        this.logger.log(
          `eBay sync-all [${i + 1}/${itemIds.length}] item=${result.itemId} inserted=${result.inserted} deduped=${result.deduped}`,
        );
      } catch (error) {
        this.logger.error(
          `eBay sync-all [${i + 1}/${itemIds.length}] item=${itemIds[i]} failed: ${(error as Error).message}`,
        );
      }

      if (i < itemIds.length - 1) {
        await this.wait(SYNC_ALL_DELAY_MS);
      }
    }

    this.isSyncAllRunning = false;
    this.logger.log(`eBay sync-all complete: processed ${itemIds.length} items`);
  }

  // Auto-sync is intentionally disabled for local/manual testing.
  // Trigger sync via the admin endpoint instead.
  async syncDueItems(): Promise<void> {
    const now = new Date();

    const dueItems = await this.itemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect(
        PrizeItemEbaySyncState,
        'sync',
        'sync.item_id = item.id',
      )
      .where('item.is_active = true')
      .andWhere('(sync.next_fetch_at IS NULL OR sync.next_fetch_at <= :now)', {
        now,
      })
      .orderBy('sync.next_fetch_at', 'ASC', 'NULLS FIRST')
      .limit(SYNC_BATCH_SIZE)
      .getMany();

    if (!dueItems.length) {
      return;
    }

    this.logger.debug(`eBay sold sync tick: processing ${dueItems.length} due items`);

    for (const item of dueItems) {
      try {
        await this.syncItem(item);
      } catch (error) {
        this.logger.error(
          `eBay sold sync failed for item ${item.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  async runManualSyncForItem(itemId: string): Promise<{
    itemId: string;
    fetched: number;
    inserted: number;
    deduped: number;
    query: string;
    calculatedAt: Date;
  }> {
    const item = await this.itemRepository.findOne({ where: { id: itemId } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    return this.syncItem(item);
  }

  private async syncItem(item: PrizeConfiguration): Promise<{
    itemId: string;
    fetched: number;
    inserted: number;
    deduped: number;
    query: string;
    calculatedAt: Date;
  }> {
    const now = new Date();
    const rawQuery = (item.ebaySearchQuery || item.name || '').trim();
    const query = normalizeEbaySearchKeywords(rawQuery);

    if (!query) {
      this.logger.warn(
        `Skipping item ${item.id} sold sync: missing name and ebaySearchQuery`,
      );
      await this.updateSyncState(item.id, {
        lastFetchAttemptedAt: now,
        nextFetchAt: this.getRandomizedNextFetchAt(now),
      });
      return {
        itemId: item.id,
        fetched: 0,
        inserted: 0,
        deduped: 0,
        query,
        calculatedAt: now,
      };
    }

    await this.updateSyncState(item.id, {
      lastFetchAttemptedAt: now,
    });

    const result = await this.fetchCompletedItemsWithRetry(query);

    const saveResult = await this.persistListings(item.id, query, result);
    const computedAt = new Date();

    await this.itemRepository.update(item.id, {
      ebayMarketLastCalculatedAt: computedAt,
    });

    await this.updateSyncState(item.id, {
      lastFetchSucceededAt: computedAt,
      lastCalculatedAt: computedAt,
      lastSeenSoldAt: saveResult.lastSeenSoldAt,
      lastSeenProviderItemId: saveResult.lastSeenProviderItemId,
      nextFetchAt: this.getRandomizedNextFetchAt(computedAt),
    });

    this.logger.log(
      `eBay sold sync item=${item.id} query="${query}" fetched=${result.products.length} inserted=${saveResult.inserted} deduped=${saveResult.deduped}`,
    );

    return {
      itemId: item.id,
      fetched: result.products.length,
      inserted: saveResult.inserted,
      deduped: saveResult.deduped,
      query,
      calculatedAt: computedAt,
    };
  }

  private async fetchCompletedItemsWithRetry(
    query: string,
  ): Promise<EbayCompletedItemsResult> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < MAX_RETRY_ATTEMPTS) {
      attempt += 1;
      try {
        return await this.ebayService.findCompletedItems(
          query,
          DEFAULT_MAX_SEARCH_RESULTS,
        );
      } catch (error) {
        lastError = error as Error;
        if (attempt >= MAX_RETRY_ATTEMPTS) {
          break;
        }

        const backoffMs = 500 * 2 ** (attempt - 1);
        this.logger.warn(
          `eBay completed-items fetch retry ${attempt}/${MAX_RETRY_ATTEMPTS - 1} for query "${query}" in ${backoffMs}ms`,
        );
        await this.wait(backoffMs);
      }
    }

    throw lastError ?? new Error('Unknown eBay completed-items error');
  }

  private async persistListings(
    itemId: string,
    searchQuery: string,
    result: EbayCompletedItemsResult,
  ): Promise<{
    inserted: number;
    deduped: number;
    lastSeenSoldAt: Date | null;
    lastSeenProviderItemId: string | null;
  }> {
    let inserted = 0;
    let deduped = 0;

    const sortedByRecency = [...result.products].sort((a, b) => {
      const aTime = a.dateSold?.getTime() ?? 0;
      const bTime = b.dateSold?.getTime() ?? 0;
      return bTime - aTime;
    });
    const newest = sortedByRecency[0];

    for (const product of result.products) {
      const salePrice = product.salePrice;
      if (salePrice === null) {
        continue;
      }

      const providerItemId = this.getCanonicalProviderItemId(product, searchQuery);
      const existing = await this.soldListingRepository.findOne({
        where: {
          itemId,
          providerItemId,
        },
      });

      if (existing) {
        deduped += 1;
        continue;
      }

      const entity = this.soldListingRepository.create({
        itemId,
        providerItemId,
        source: result.source,
        searchQuery,
        soldTitle: product.title || searchQuery,
        salePrice: salePrice.toFixed(2),
        currencySymbol: product.currencySymbol,
        dateSold: product.dateSold,
        imageUrl: product.imageUrl,
        listingUrl: product.listingUrl,
        shippingPrice:
          product.shippingPrice !== null ? product.shippingPrice.toFixed(2) : null,
        itemCondition: product.itemCondition,
        buyingFormat: product.buyingFormat,
        responseUrl: result.responseUrl,
        rawPayload: product.rawPayload,
      });

      await this.soldListingRepository.save(entity);
      inserted += 1;
    }

    return {
      inserted,
      deduped,
      lastSeenSoldAt: newest?.dateSold ?? null,
      lastSeenProviderItemId:
        newest !== undefined
          ? this.getCanonicalProviderItemId(newest, searchQuery)
          : null,
    };
  }

  private getCanonicalProviderItemId(
    product: EbayCompletedItem,
    query: string,
  ): string {
    if (product.providerItemId) {
      return product.providerItemId;
    }

    const fingerprint = [
      query,
      product.title || '',
      product.salePrice ?? '',
      product.currencySymbol || '',
      product.dateSold?.toISOString() || '',
      product.listingUrl || '',
    ].join('|');

    return `hash_${createHash('sha1').update(fingerprint).digest('hex')}`;
  }

  private getRandomizedNextFetchAt(from: Date): Date {
    const minHours = 18;
    const maxHours = 30;
    const offsetHours =
      minHours + Math.floor(Math.random() * (maxHours - minHours + 1));
    const next = new Date(from);
    next.setHours(next.getHours() + offsetHours);
    return next;
  }

  private async updateSyncState(
    itemId: string,
    updates: Partial<PrizeItemEbaySyncState>,
  ): Promise<void> {
    let syncState = await this.syncStateRepository.findOne({ where: { itemId } });
    if (!syncState) {
      syncState = this.syncStateRepository.create({ itemId });
    }

    Object.assign(syncState, updates);
    await this.syncStateRepository.save(syncState);
  }

  private async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}