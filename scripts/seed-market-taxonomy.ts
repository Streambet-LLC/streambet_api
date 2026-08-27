/**
 * Seed / re-seed the default market taxonomy, then print an auto-tag coverage
 * preview over the existing card tables. Re-runnable: curated nodes are never
 * overwritten. Run the migration first so the table exists.
 *
 * Usage (env overrides win over .env — point at whichever DB):
 *   DB_DATABASE=cardcade-stag DB_SSL=true \
 *   npx ts-node -r tsconfig-paths/register scripts/seed-market-taxonomy.ts
 */
import 'reflect-metadata';
import dataSource from '../typeorm.config';
import { MarketTaxonomyNode } from '../src/admin/entities/market-taxonomy.entity';
import { MarketTaxonomyService } from '../src/admin/market-taxonomy.service';

async function main() {
  await dataSource.initialize();
  const svc = new MarketTaxonomyService(
    dataSource.getRepository(MarketTaxonomyNode),
    dataSource,
  );

  console.log(`[taxonomy] seeding against db=${process.env.DB_DATABASE} …`);
  const seed = await svc.seedDefaults();
  console.log(`[taxonomy] seeded ${seed.seeded} default node(s); table now holds ${seed.total}.`);

  const stats = await svc.stats();
  console.log(`[taxonomy] by kind:`, stats);

  for (const source of ['tracked_cards', 'sold_cards'] as const) {
    const d = (await svc.distribution(source)) as {
      totalRows: number;
      taggedMarket: number;
      taggedAny: number;
      untagged: number;
      byMarket: { label: string; count: number }[];
      byPlayer: { label: string; count: number }[];
      bySet: { label: string; count: number }[];
    };
    console.log(
      `\n[taxonomy] ${source}: ${d.totalRows} rows — market-tagged ${d.taggedMarket}, any-tagged ${d.taggedAny}, untagged ${d.untagged}`,
    );
    if (d.byMarket.length) {
      console.log('  markets:', d.byMarket.map((m) => `${m.label}=${m.count}`).join('  '));
    }
    if (d.bySet.length) {
      console.log('  sets:   ', d.bySet.slice(0, 8).map((m) => `${m.label}=${m.count}`).join('  '));
    }
    if (d.byPlayer.length) {
      console.log('  players:', d.byPlayer.slice(0, 8).map((m) => `${m.label}=${m.count}`).join('  '));
    }
  }

  await dataSource.destroy();
  console.log('\n[taxonomy] done.');
}

main().catch((e) => {
  console.error('[taxonomy] FAILED:', (e as Error).message);
  process.exit(1);
});
