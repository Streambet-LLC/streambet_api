/**
 * One-off / cron-able first-party engagement collector — rolls up platform
 * views + saves onto taxonomy nodes. Seed the taxonomy first.
 *
 * Usage (env overrides win over .env):
 *   DB_DATABASE=cardcade-prod DB_SSL=true \
 *   npx ts-node -r tsconfig-paths/register scripts/collect-market-engagement.ts
 */
import 'reflect-metadata';
import dataSource from '../typeorm.config';
import { MarketTaxonomyNode } from '../src/admin/entities/market-taxonomy.entity';
import { MarketTaxonomyService } from '../src/admin/market-taxonomy.service';
import { MarketEngagementService } from '../src/admin/market-engagement.service';

async function main() {
  await dataSource.initialize();
  const taxonomy = new MarketTaxonomyService(
    dataSource.getRepository(MarketTaxonomyNode),
    dataSource,
  );
  const svc = new MarketEngagementService(dataSource, taxonomy);

  console.log(`[engagement] collecting against db=${process.env.DB_DATABASE} …`);
  const results = await svc.collectAll();
  for (const r of results) {
    console.log(
      `  ${r.segment.padEnd(24)} items=${r.itemCount}  views=${r.totalViews}  watchers=${r.totalWatchers}  new7dViews=${r.newViews7d}  new7dWatch=${r.newWatchers7d}`,
    );
  }
  await dataSource.destroy();
  console.log(`[engagement] done — ${results.length} node(s) snapshotted.`);
}

main().catch((e) => {
  console.error('[engagement] FAILED:', (e as Error).message);
  process.exit(1);
});
