/**
 * One-shot ordered migration replay.
 *
 * TypeORM sorts pending migrations by the last 13 chars of the class name.
 * This repo mixes 13-digit epoch timestamps with 14-digit YYYYMMDDHHMMSS
 * timestamps, so the newer (14-digit) migrations get a mangled, smaller sort
 * key and run BEFORE the foundational tables they depend on. That's fine when
 * migrations are applied incrementally, but a bulk replay onto a DB that
 * skipped a batch (e.g. consolidating onto a stale prod snapshot) breaks.
 *
 * This script computes each pending migration's TRUE timestamp and runs them
 * up() in that order, recording each in the migrations table. Each migration
 * runs in its own transaction so a failure stops cleanly and names the culprit.
 *
 * Usage (env overrides win over .env):
 *   DB_HOST=... DB_DATABASE=... DB_USERNAME=postgres DB_SSL=true \
 *   ts-node -r tsconfig-paths/register scripts/ordered-migrate.ts [--dry]
 */
import 'reflect-metadata';
import type { MigrationInterface } from 'typeorm';
import dataSource from '../typeorm.config';

const DRY = process.argv.includes('--dry');

const nameOf = (m: MigrationInterface): string =>
  (m as unknown as { name?: string }).name || m.constructor.name;

/** Interpret the trailing digit group as a real epoch-ms instant. */
function trueTs(name: string): number {
  const d = (name.match(/(\d+)$/) || ['0'])[1];
  if (d.length === 13) return parseInt(d, 10); // epoch ms
  if (d.length === 14)
    return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8),
      +d.slice(8, 10), +d.slice(10, 12), +d.slice(12, 14)); // YYYYMMDDHHMMSS
  if (d.length === 8)
    return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)); // YYYYMMDD
  return parseInt(d, 10);
}

async function main() {
  await dataSource.initialize();
  const qr = dataSource.createQueryRunner();
  try {
    const executed: Array<{ name: string }> = await qr.query('SELECT name FROM migrations');
    const done = new Set(executed.map(r => r.name));

    const pending = dataSource.migrations
      .filter(m => !done.has(nameOf(m)))
      .sort((a, b) => trueTs(nameOf(a)) - trueTs(nameOf(b)));

    console.log(`executed=${done.size}  pending=${pending.length}  target=${done.size + pending.length}`);
    console.log('--- planned order ---');
    pending.forEach((m, i) =>
      console.log(String(i + 1).padStart(3) + '. ' + new Date(trueTs(nameOf(m))).toISOString().slice(0, 10) + '  ' + nameOf(m)));

    if (DRY) { console.log('DRY RUN — nothing executed.'); return; }

    // Defer-and-retry: some migrations are backdated in ways that invert real
    // dependencies, so no static order is correct. Attempt each in true-ts
    // order; whatever fails (missing table/column) is deferred and retried on
    // the next pass once its dependency has been created. Each migration runs
    // in its own transaction, so a failed attempt rolls back cleanly and is
    // safe to retry. Converges unless a migration has a genuine (non-ordering)
    // error — then a full pass makes no progress and we report the stuck set.
    console.log('--- executing (defer-and-retry) ---');
    let remaining = pending.slice();
    const lastError = new Map<string, string>();
    let pass = 0;
    while (remaining.length) {
      pass++;
      const stuck: typeof remaining = [];
      let appliedThisPass = 0;
      for (const m of remaining) {
        const nm = nameOf(m);
        await qr.startTransaction();
        try {
          await m.up(qr);
          await qr.query('INSERT INTO migrations("timestamp", "name") VALUES ($1, $2)', [trueTs(nm), nm]);
          await qr.commitTransaction();
          console.log(`OK   [p${pass}] ` + nm);
          appliedThisPass++;
        } catch (e) {
          await qr.rollbackTransaction();
          lastError.set(nm, (e as Error).message);
          stuck.push(m);
        }
      }
      console.log(`--- pass ${pass}: applied ${appliedThisPass}, deferred ${stuck.length} ---`);
      if (appliedThisPass === 0) {
        console.log('NO PROGRESS — the following could not be applied:');
        for (const m of stuck) console.log('  STUCK ' + nameOf(m) + '  ->  ' + lastError.get(nameOf(m)));
        throw new Error(`${stuck.length} migration(s) stuck after pass ${pass}`);
      }
      remaining = stuck;
    }
    console.log('DONE — all pending migrations applied.');
  } finally {
    await qr.release();
    await dataSource.destroy();
  }
}

main().catch(e => { console.error('ABORTED: ' + (e as Error).message); process.exit(1); });
