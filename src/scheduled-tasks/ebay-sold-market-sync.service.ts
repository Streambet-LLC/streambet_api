import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { EBAY_MIGRATION_QUEUE } from 'src/common/constants/queue.constants';
import { PrizeConfiguration } from 'src/prize/entities/prize-configuration.entity';
import { PrizeItemEbaySoldListing } from 'src/prize/entities/prize-item-ebay-sold-listing.entity';
import { PrizeItemEbaySyncState } from 'src/prize/entities/prize-item-ebay-sync-state.entity';
import {
  EbayCompletedItem,
  EbayCompletedItemsResult,
  EbayService,
} from 'src/integrations/ebay/ebay.service';
import {
  normalizeEbaySearchKeywords,
  extractPsaGradeFromItemTitle,
  psaGradesMatch,
  extractCardNumberFromTitle,
  cardNumbersMatch,
  extractYearFromTitle,
  yearsMatch,
} from 'src/integrations/ebay/ebay-query.utils';

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
    @InjectQueue(EBAY_MIGRATION_QUEUE)
    private readonly migrationQueue: Queue,
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
    autoFlagged: number;
    query: string;
    calculatedAt: Date;
  }> {
    const item = await this.itemRepository.findOne({ where: { id: itemId } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    return this.syncItem(item);
  }

  async queuePsaGradeFlagsMigration(): Promise<{
    jobId: string;
    message: string;
    estimatedItems: number;
  }> {
    const itemCount = await this.itemRepository.count();
    
    const job = await this.migrationQueue.add('migrate-psa-flags', { totalItems: itemCount }, {
      jobId: `psa-migration-${Date.now()}`,
    });

    this.logger.log(
      `PSA grade migration queued: jobId=${job.id}, estimatedItems=${itemCount}`,
    );

    return {
      jobId: job.id as string,
      message: 'Migration job queued successfully. This will run in the background and may take several minutes.',
      estimatedItems: itemCount,
    };
  }

  async getPsaGradeFlagsMigrationStatus(jobId: string): Promise<{
    jobId: string;
    state: string;
    progress: number;
    processedItems: number;
    totalItems: number;
    result?: any;
  }> {
    const job = await this.migrationQueue.getJob(jobId);
    
    if (!job) {
      return {
        jobId,
        state: 'not-found',
        progress: 0,
        processedItems: 0,
        totalItems: 0,
      };
    }

    const state = await job.getState();
    const progress = job.progress as any;
    const jobData = job.data as any;

    return {
      jobId,
      state,
      progress: typeof progress === 'number' ? progress : progress?.percent || 0,
      processedItems: progress?.processedItems || 0,
      totalItems: jobData?.totalItems || 0,
      result: state === 'completed' ? job.returnvalue : undefined,
    };
  }

  async migratePsaGradeFlags(job?: any): Promise<{
    totalListings: number;
    flaggedCount: number;
    unflaggedCount: number;
    unchangedCount: number;
  }> {
    this.logger.log('Starting PSA grade, card number, and year migration for existing sold listings...');

    // Get all items with their sold listings
    const items = await this.itemRepository.find({
      select: ['id', 'name', 'ebaySearchQuery'],
    });

    const totalItems = items.length;
    let totalListings = 0;
    let flaggedCount = 0;
    let unflaggedCount = 0;
    let unchangedCount = 0;
    let processedItems = 0;

    for (const item of items) {
      const rawQuery = (item.ebaySearchQuery || item.name || '').trim();
      const itemPsaGrade = extractPsaGradeFromItemTitle(rawQuery);
      const itemCardNumber = extractCardNumberFromTitle(rawQuery);
      const itemYear = extractYearFromTitle(rawQuery);

      // Skip items without PSA grades, card numbers, or year - they don't need filtering
      if (!itemPsaGrade && !itemCardNumber && !itemYear) {
        processedItems++;
        if (job) {
          await job.updateProgress({
            percent: Math.round((processedItems / totalItems) * 100),
            processedItems,
            totalItems,
          });
        }
        continue;
      }

      // Get all sold listings for this item
      const listings = await this.soldListingRepository.find({
        where: { itemId: item.id },
      });

      for (const listing of listings) {
        totalListings++;

        const soldListingPsaGrade = extractPsaGradeFromItemTitle(listing.soldTitle);
        const soldListingCardNumber = extractCardNumberFromTitle(listing.soldTitle);
        const soldListingYear = extractYearFromTitle(listing.soldTitle);
        let shouldBeInaccurate = false;
        let reason: string | null = null;

        // Check PSA grade if item has one
        if (itemPsaGrade) {
          if (!soldListingPsaGrade) {
            shouldBeInaccurate = true;
            reason = 'Auto-flagged: Missing PSA grade';
          } else if (!psaGradesMatch(itemPsaGrade, soldListingPsaGrade)) {
            shouldBeInaccurate = true;
            reason = `Auto-flagged: PSA grade mismatch (expected ${itemPsaGrade}, found ${soldListingPsaGrade})`;
          }
        }

        // Check card number if item has one (independent of PSA grade)
        if (!shouldBeInaccurate && itemCardNumber) {
          if (!soldListingCardNumber) {
            shouldBeInaccurate = true;
            reason = 'Auto-flagged: Missing card number';
          } else if (!cardNumbersMatch(itemCardNumber, soldListingCardNumber)) {
            shouldBeInaccurate = true;
            reason = `Auto-flagged: Card number mismatch (expected #${itemCardNumber}, found #${soldListingCardNumber})`;
          }
        }

        // Check year if item has one (independent of PSA grade and card number)
        if (!shouldBeInaccurate && itemYear) {
          if (!soldListingYear) {
            shouldBeInaccurate = true;
            reason = 'Auto-flagged: Missing year';
          } else if (!yearsMatch(itemYear, soldListingYear)) {
            shouldBeInaccurate = true;
            reason = `Auto-flagged: Year mismatch (expected ${itemYear}, found ${soldListingYear})`;
          }
        }

        // Update if flags changed
        if (listing.isInaccurate !== shouldBeInaccurate) {
          listing.isInaccurate = shouldBeInaccurate;
          listing.inaccurateReason = reason;
          listing.inaccurateFlaggedAt = shouldBeInaccurate ? new Date() : null;
          await this.soldListingRepository.save(listing);

          if (shouldBeInaccurate) {
            flaggedCount++;
          } else {
            unflaggedCount++;
          }
        } else {
          unchangedCount++;
        }
      }

      this.logger.debug(
        `Migrated item ${item.id}: psaGrade=${itemPsaGrade || 'none'}, cardNumber=${itemCardNumber ? '#' + itemCardNumber : 'none'}, year=${itemYear || 'none'}, listings=${listings.length}`,
      );

      processedItems++;
      if (job) {
        await job.updateProgress({
          percent: Math.round((processedItems / totalItems) * 100),
          processedItems,
          totalItems,
        });
      }
    }

    this.logger.log(
      `PSA grade, card number, and year migration complete: total=${totalListings}, flagged=${flaggedCount}, unflagged=${unflaggedCount}, unchanged=${unchangedCount}`,
    );

    return {
      totalListings,
      flaggedCount,
      unflaggedCount,
      unchangedCount,
    };
  }

  private async syncItem(item: PrizeConfiguration): Promise<{
    itemId: string;
    fetched: number;
    inserted: number;
    deduped: number;
    autoFlagged: number;
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
        autoFlagged: 0,
        query,
        calculatedAt: now,
      };
    }

    // Extract PSA grade, card number, and year from the original item title for filtering
    const itemPsaGrade = extractPsaGradeFromItemTitle(rawQuery);
    const itemCardNumber = extractCardNumberFromTitle(rawQuery);
    const itemYear = extractYearFromTitle(rawQuery);

    await this.updateSyncState(item.id, {
      lastFetchAttemptedAt: now,
    });

    const result = await this.fetchCompletedItemsWithRetry(query);

    const saveResult = await this.persistListings(item.id, query, result, itemPsaGrade, itemCardNumber, itemYear);
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
      `eBay sold sync item=${item.id} query="${query}" psaGrade=${itemPsaGrade || 'none'} cardNumber=${itemCardNumber ? '#' + itemCardNumber : 'none'} year=${itemYear || 'none'} fetched=${result.products.length} inserted=${saveResult.inserted} deduped=${saveResult.deduped} autoFlagged=${saveResult.autoFlagged}`,
    );

    return {
      itemId: item.id,
      fetched: result.products.length,
      inserted: saveResult.inserted,
      deduped: saveResult.deduped,
      autoFlagged: saveResult.autoFlagged,
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
    itemPsaGrade: string | null,
    itemCardNumber: string | null,    itemYear: string | null,  ): Promise<{
    inserted: number;
    deduped: number;
    autoFlagged: number;
    lastSeenSoldAt: Date | null;
    lastSeenProviderItemId: string | null;
  }> {
    let inserted = 0;
    let deduped = 0;
    let autoFlagged = 0;

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

      // PSA grade and card number filtering: auto-flag if they don't match
      let isInaccurate = false;
      let inaccurateReason: string | null = null;

      if (itemPsaGrade) {
        const soldListingPsaGrade = extractPsaGradeFromItemTitle(product.title || '');
        
        if (!soldListingPsaGrade) {
          // Item has PSA grade but sold listing doesn't
          isInaccurate = true;
          inaccurateReason = 'Auto-flagged: Missing PSA grade';
          autoFlagged += 1;
        } else if (!psaGradesMatch(itemPsaGrade, soldListingPsaGrade)) {
          // Both have PSA grades but they don't match
          isInaccurate = true;
          inaccurateReason = `Auto-flagged: PSA grade mismatch (expected ${itemPsaGrade}, found ${soldListingPsaGrade})`;
          autoFlagged += 1;
        }
      }

      // Card number filtering (independent of PSA grade)
      if (!isInaccurate && itemCardNumber) {
        const soldListingCardNumber = extractCardNumberFromTitle(product.title || '');
        
        if (!soldListingCardNumber) {
          // Item has card number but sold listing doesn't
          isInaccurate = true;
          inaccurateReason = 'Auto-flagged: Missing card number';
          autoFlagged += 1;
        } else if (!cardNumbersMatch(itemCardNumber, soldListingCardNumber)) {
          // Both have card numbers but they don't match
          isInaccurate = true;
          inaccurateReason = `Auto-flagged: Card number mismatch (expected #${itemCardNumber}, found #${soldListingCardNumber})`;
          autoFlagged += 1;
        }
      }

      // Year filtering (independent of PSA grade and card number)
      if (!isInaccurate && itemYear) {
        const soldListingYear = extractYearFromTitle(product.title || '');
        
        if (!soldListingYear) {
          // Item has year but sold listing doesn't
          isInaccurate = true;
          inaccurateReason = 'Auto-flagged: Missing year';
          autoFlagged += 1;
        } else if (!yearsMatch(itemYear, soldListingYear)) {
          // Both have years but they don't match
          isInaccurate = true;
          inaccurateReason = `Auto-flagged: Year mismatch (expected ${itemYear}, found ${soldListingYear})`;
          autoFlagged += 1;
        }
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
        isInaccurate,
        inaccurateReason,
        inaccurateFlaggedAt: isInaccurate ? new Date() : null,
      });

      await this.soldListingRepository.save(entity);
      inserted += 1;
    }

    return {
      inserted,
      deduped,
      autoFlagged,
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