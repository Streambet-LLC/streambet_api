/* eslint-disable no-console */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ValuationService } from '../admin/card-market/valuation.service';
import { isPricingComp } from '../admin/card-market/valuation.util';
import { VALUATION_FIXTURES, ValuationFixture } from './valuation-fixtures';

/**
 * Golden-card valuation eval. Runs each fixture through the real ValuationService
 * (live comp research + code-computed price/confidence) and scores its BEHAVIOR
 * against structural expectations — so you can measure reliability and catch
 * regressions before a demo, instead of eyeballing one card at a time.
 *
 *   npm run eval:valuation            # all fixtures
 *   npm run eval:valuation -- 0 1     # only fixtures at those indices
 */

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;

function scoreFixture(
  fx: ValuationFixture,
  v: Awaited<ReturnType<ValuationService['valueCard']>>,
): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail = '') =>
    checks.push({ name, pass, detail });

  add('identified as a card', v.isCard, v.isCard ? '' : 'isCard=false');

  const hasPoint = v.pointUsd != null;
  add('produced a value', hasPoint, hasPoint ? money(v.pointUsd) : 'no point value');

  if (fx.minUsd != null || fx.maxUsd != null) {
    const inRange =
      hasPoint &&
      (fx.minUsd == null || v.pointUsd! >= fx.minUsd) &&
      (fx.maxUsd == null || v.pointUsd! <= fx.maxUsd);
    add(
      `value within [${money(fx.minUsd)}, ${money(fx.maxUsd)}]`,
      inRange,
      money(v.pointUsd),
    );
  }

  if (fx.expectMethod) {
    const ok = fx.expectMethod.includes(v.method);
    add(
      `method in {${fx.expectMethod.join(', ')}}`,
      ok,
      `got "${v.method}"`,
    );
  }

  if (fx.minConfidence != null || fx.maxConfidence != null) {
    const ok =
      (fx.minConfidence == null || v.confidencePct >= fx.minConfidence) &&
      (fx.maxConfidence == null || v.confidencePct <= fx.maxConfidence);
    add(
      `confidence in [${fx.minConfidence ?? 0}, ${fx.maxConfidence ?? 100}]`,
      ok,
      `${v.confidencePct}% — ${v.confidenceBasis}`,
    );
  }

  if (fx.requireComps) {
    const priced = v.compsUsed.filter(isPricingComp);
    add(
      'has >=1 grounded sale comp (url+sale type)',
      priced.length >= 1,
      `${priced.length} pricing comp(s)`,
    );
  }

  // Grounding invariant (always): every SALE-typed comp must carry a url.
  const unsourced = v.compsUsed.filter(
    c =>
      ['auction-sale', 'private-sale', 'sold', 'auction'].includes(
        (c.sourceType || '').toLowerCase(),
      ) && !c.url,
  );
  add(
    'no unsourced sale comps (anti-phantom)',
    unsourced.length === 0,
    unsourced.length ? `${unsourced.length} sale comp(s) missing url` : '',
  );

  // Anchor-and-adjust must carry an anchor.
  if (v.method === 'anchor-and-adjust') {
    add(
      'anchor sale present',
      !!v.anchorComp,
      v.anchorComp ? `${money(v.anchorComp.priceUsd)} @ ${v.anchorComp.date}` : 'no anchor',
    );
    // A stale anchor must be labelled AND carry a wider range — an old print
    // quoted at +/-8% reads as a live price. Regression guard.
    if (v.anchorIsStale && v.pointUsd && v.lowUsd != null && v.highUsd != null) {
      const halfWidth = (v.highUsd - v.lowUsd) / 2 / v.pointUsd;
      add(
        'stale anchor widens the range (>10%)',
        halfWidth > 0.1,
        `${v.anchorAgeDays}d old, +/-${Math.round(halfWidth * 100)}%`,
      );
      add(
        'stale anchor is labelled in the confidence basis',
        /stale/i.test(v.confidenceBasis),
        v.confidenceBasis,
      );
    }
  }

  return checks;
}

async function main() {
  const argv = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const fixtures = argv.length
    ? argv.map(i => VALUATION_FIXTURES[i]).filter(Boolean)
    : VALUATION_FIXTURES;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const svc = app.get(ValuationService);
  if (!svc.isConfigured()) {
    console.error('AI is not configured (missing ANTHROPIC_API_KEY). Aborting.');
    await app.close();
    process.exit(2);
  }

  console.log(`\n=== VALUATION EVAL — ${fixtures.length} card(s) ===\n`);
  let totalChecks = 0;
  let passedChecks = 0;
  let fixturesPassed = 0;

  for (const fx of fixtures) {
    process.stdout.write(`▶ ${fx.subject}\n  researching…`);
    let checks: Check[];
    try {
      const v = await svc.valueCard(fx.subject);
      checks = scoreFixture(fx, v);
      process.stdout.write(
        `\r  ${money(v.pointUsd)} (${v.confidencePct}%) via ${v.method} · ` +
          `${v.compsUsed.length} comp(s)                     \n`,
      );
    } catch (e) {
      checks = [
        { name: 'valueCard did not throw', pass: false, detail: (e as Error).message },
      ];
      process.stdout.write(`\r  ERROR: ${(e as Error).message}\n`);
    }

    const fxPass = checks.every(c => c.pass);
    if (fxPass) fixturesPassed++;
    for (const c of checks) {
      totalChecks++;
      if (c.pass) passedChecks++;
      console.log(`    ${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
    console.log(`    ${fxPass ? 'PASS' : 'FAIL'} · ${fx.notes}\n`);
  }

  console.log('=== SUMMARY ===');
  console.log(`  fixtures: ${fixturesPassed}/${fixtures.length} passed`);
  console.log(`  checks:   ${passedChecks}/${totalChecks} passed\n`);

  await app.close();
  process.exit(fixturesPassed === fixtures.length ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
