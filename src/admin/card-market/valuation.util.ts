/**
 * Deterministic valuation math + confidence rubric.
 *
 * The LLM's job is to RETRIEVE structured evidence — the comps it actually
 * found (price, date, grade, source type, url), an anchor sale, and an index
 * move. This module does the ARITHMETIC and the CONFIDENCE scoring in plain
 * TypeScript so those numbers are consistent and un-hallucinatable: anchor x
 * index, trimmed median, outlier rejection, and an evidence-tied confidence %.
 */

export type ValMethod = 'anchor-and-adjust' | 'recent-median' | 'triangulation';

/** One retrieved comp / data point. */
export interface ValComp {
  priceUsd: number;
  /** YYYY-MM-DD, when known. */
  date: string | null;
  grade: string | null;
  /** auction-sale | private-sale | marketplace-listing | price-guide | index */
  sourceType: string;
  url: string | null;
}

export interface ValInputs {
  method: ValMethod;
  /** The most-recent confirmed sale to anchor on (anchor-and-adjust). */
  anchorComp: ValComp | null;
  /** All comps the model retrieved. */
  compsUsed: ValComp[];
  /** Signed index move since the anchor date, in percent (e.g. -6.3). */
  indexMovePct: number | null;
  /** Model's own point/range — used only as the triangulation fallback. */
  modelPoint: number | null;
  modelLow: number | null;
  modelHigh: number | null;
  /** Reference "today" (YYYY-MM-DD) so results are reproducible in tests. */
  today: string;
}

export interface ValOutput {
  pointUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  confidencePct: number;
  confidenceBasis: string;
  /** The comps that actually counted as priceable sales, newest-first. */
  pricingComps: ValComp[];
}

const SALE_TYPES = new Set(['auction-sale', 'private-sale', 'sold', 'auction']);

/** A comp counts toward a price only if it is a confirmed sale WITH a source. */
export const isPricingComp = (c: ValComp): boolean =>
  !!c &&
  typeof c.priceUsd === 'number' &&
  c.priceUsd > 0 &&
  SALE_TYPES.has((c.sourceType || '').toLowerCase()) &&
  !!c.url;

/** Whole days between a YYYY-MM-DD date and `today`; large number if unknown. */
export const daysBetween = (date: string | null, today: string): number => {
  if (!date) return 3650;
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 3650;
  return Math.max(0, Math.round((b - a) / 86400000));
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median dropping the single lowest + highest once N >= 6. */
export const trimmedMedian = (xs: number[]): number => {
  if (xs.length >= 6) {
    const s = [...xs].sort((a, b) => a - b);
    return median(s.slice(1, -1));
  }
  return median(xs);
};

/** Coefficient of variation (stdev/mean); 0 when <2 points or mean 0. */
export const cv = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return 0;
  const variance =
    xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

// Rubric factor lookups (blueprint §3).
const recencyFactor = (d: number): number =>
  d <= 14 ? 1.0 : d <= 30 ? 0.9 : d <= 90 ? 0.75 : d <= 180 ? 0.55 : d <= 365 ? 0.4 : 0.25;
const countFactor = (n: number): number =>
  n >= 8 ? 1.0 : n >= 5 ? 0.9 : n >= 3 ? 0.7 : n === 2 ? 0.55 : n === 1 ? 0.4 : 0.25;
const dispersionFactor = (c: number, single: boolean): number => {
  if (single) return 0.6;
  return c <= 0.05 ? 1.0 : c <= 0.1 ? 0.9 : c <= 0.2 ? 0.75 : c <= 0.35 ? 0.55 : 0.4;
};

/**
 * Evidence-tied confidence: f(# recent comps, recency of newest, dispersion),
 * with a small bonus for a real index-adjusted anchor and a hard cap on
 * triangulated estimates.
 */
export const computeConfidence = (opts: {
  method: ValMethod;
  nRecent: number;
  dLastDays: number;
  cv: number;
  hasIndex: boolean;
  single: boolean;
}): { pct: number; basis: string } => {
  const R = recencyFactor(opts.dLastDays);
  const C = countFactor(opts.nRecent);
  const D = dispersionFactor(opts.cv, opts.single || opts.method === 'triangulation');
  let pct = Math.round(100 * (0.35 * R + 0.3 * C + 0.35 * D));
  if (opts.method === 'anchor-and-adjust' && opts.hasIndex) pct += 6;
  pct = clamp(pct, 20, 98);
  if (opts.method === 'triangulation') pct = Math.min(pct, 55);

  const spread =
    opts.nRecent >= 2 ? ` spread +-${Math.round(opts.cv * 100)}%` : '';
  const recency =
    opts.dLastDays >= 3650 ? 'no dated comp' : `newest ${opts.dLastDays}d ago`;
  let basis: string;
  if (opts.method === 'triangulation') {
    basis = 'triangulated estimate — no direct comps';
  } else if (opts.method === 'anchor-and-adjust') {
    const ageTxt =
      opts.dLastDays >= 3650 ? 'undated' : `${opts.dLastDays}d old`;
    basis = `anchored on last sale (${ageTxt})${opts.hasIndex ? ', index-adjusted' : ''}`;
  } else {
    basis = `${opts.nRecent} recent comp${opts.nRecent === 1 ? '' : 's'}, ${recency}${spread}`;
  }
  return { pct, basis };
};

/**
 * Compute the deterministic point/range + confidence from retrieved evidence.
 * Never invents prices — it only arithmetic-combines the comps/anchor the model
 * actually returned. Triangulation falls back to the model's own estimate
 * (code can't derive analogs) but still scores confidence by the rubric.
 */
export const computeValuation = (input: ValInputs): ValOutput => {
  const comps = (input.compsUsed ?? []).filter(isPricingComp);
  // Newest-first.
  comps.sort(
    (a, b) => daysBetween(a.date, input.today) - daysBetween(b.date, input.today),
  );
  const recent = comps.filter(c => daysBetween(c.date, input.today) <= 90);
  const pricing = recent.length >= 1 ? recent : comps; // widen if nothing <=90d
  const prices = pricing.map(c => c.priceUsd);
  const nRecent = recent.length;
  const dLast = pricing.length ? daysBetween(pricing[0].date, input.today) : 3650;
  const dispersion = cv(prices);

  let point: number | null = null;
  let low: number | null = null;
  let high: number | null = null;

  if (input.method === 'anchor-and-adjust') {
    const anchor =
      input.anchorComp && isPricingComp(input.anchorComp)
        ? input.anchorComp
        : pricing[0] ?? null;
    if (anchor) {
      const move = input.indexMovePct ?? 0;
      point = anchor.priceUsd * (1 + move / 100);
      const h = 0.08;
      low = point * (1 - h);
      high = point * (1 + h);
    }
  } else if (input.method === 'recent-median') {
    if (prices.length) {
      point = trimmedMedian(prices);
      low = Math.min(...prices);
      high = Math.max(...prices);
    }
  }

  // Triangulation (or any route with no usable comps) → model's own estimate.
  if (point == null) {
    point = input.modelPoint;
    low = input.modelLow;
    high = input.modelHigh;
  }

  const single =
    input.method === 'anchor-and-adjust' && nRecent <= 1;
  const conf = computeConfidence({
    method: input.method,
    nRecent,
    dLastDays: dLast,
    cv: dispersion,
    hasIndex: input.indexMovePct != null,
    single,
  });

  const round2 = (n: number | null) =>
    n == null ? null : Math.round(n * 100) / 100;

  return {
    pointUsd: round2(point),
    lowUsd: round2(low),
    highUsd: round2(high),
    confidencePct: conf.pct,
    confidenceBasis: conf.basis,
    pricingComps: pricing,
  };
};
