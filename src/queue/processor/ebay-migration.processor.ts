import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EBAY_MIGRATION_QUEUE } from 'src/common/constants/queue.constants';
import type { EbaySoldMarketSyncService } from 'src/scheduled-tasks/ebay-sold-market-sync.service';

@Injectable()
@Processor(EBAY_MIGRATION_QUEUE)
export class EbayMigrationProcessor extends WorkerHost {
  private readonly logger = new Logger(EbayMigrationProcessor.name);

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.log(`Processing eBay migration job: ${job.name} (${job.id})`);

    try {
      if (job.name === 'migrate-psa-flags') {
        this.logger.log('Starting PSA migration - importing service...');
        
        // Dynamically get the service to avoid circular dependency
        const { EbaySoldMarketSyncService } = await import(
          '../../scheduled-tasks/ebay-sold-market-sync.service'
        );
        
        this.logger.log('Service imported, retrieving from ModuleRef...');
        
        const syncService = this.moduleRef.get(EbaySoldMarketSyncService, {
          strict: false,
        });

        this.logger.log('Service retrieved, calling migratePsaGradeFlags...');

        const result = await syncService.migratePsaGradeFlags(job);

        this.logger.log(
          `PSA migration completed: total=${result.totalListings}, flagged=${result.flaggedCount}, unflagged=${result.unflaggedCount}, unchanged=${result.unchangedCount}`,
        );

        return result;
      }

      throw new Error(`Unknown job name: ${job.name}`);
    } catch (error) {
      this.logger.error(
        `PSA migration job failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
