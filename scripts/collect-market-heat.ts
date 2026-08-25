/**
 * One-off / cron-able market-heat collector. Runs the SAME core logic the
 * NestJS daily @Cron uses (collectMarketHeat), so it can seed the first
 * snapshot now (before deploy) and be re-run daily if needed.
 *
 * Usage (env overrides win over .env — point at whichever DB):
 *   DB_DATABASE=cardcade-prod DB_SSL=true \
 *   npx ts-node -r tsconfig-paths/register scripts/collect-market-heat.ts
 */
import 'reflect-metadata';
import dataSource from '../typeorm.config';
import { EbayBrowseSource } from '../src/admin/card-market/ebay-browse.source';
import { collectMarketHeat } from '../src/admin/market-heat.service';

async function main() {
  await dataSource.initialize();
  const ebay = new EbayBrowseSource();
  if (!ebay.isConfigured()) {
    console.error('eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET).');
    process.exit(1);
  }
  console.log(
    `[market-heat] collecting against db=${process.env.DB_DATABASE} …`,
  );
  const results = await collectMarketHeat(dataSource, ebay);
  for (const r of results) {
    console.log(
      `  ${r.segment.padEnd(10)} total=${r.totalActive}  sample=${r.sampleActive}  new=${r.newCount}  cleared=${r.clearedCount}  heat=${r.heatScore ?? '-'}  medianAsk=${r.medianAskUsd ?? '-'}`,
    );
  }
  await dataSource.destroy();
  console.log(`[market-heat] done — ${results.length} segment(s) snapshotted.`);
}

main().catch(e => {
  console.error('[market-heat] FAILED:', (e as Error).message);
  process.exit(1);
});
