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
  /**
   * The sale's OWN title as printed on the source page, verbatim — e.g.
   * "2019 Panini Prizm Color Blast Patrick Mahomes II PSA 10".
   *
   * This is the only per-comp signal that says WHICH card actually sold. On a
   * PSA sales-history page every row shares one page url, so without a title
   * the verifier cannot tell the subject card from a different parallel logged
   * on the same page — it can only spot price outliers, which silently lets a
   * plausibly-priced wrong-parallel sale through and anchor the valuation.
   */
  title: string | null;
  /** auction-sale | private-sale | marketplace-listing | price-guide | index */
  sourceType: string;
  url: string | null;
}

/**
 * Same underlying sale? Identity is (price, date, url) — NOT url alone, because
 * every row on a PSA sales-history page shares the page url.
 */
export const isSameComp = (a: ValComp, b: ValComp): boolean =>
  a.priceUsd === b.priceUsd && a.date === b.date && a.url === b.url;

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
  /** The comp we anchored on — the NEWEST dated sale (code-chosen, not model). */
  anchor: ValComp | null;
  /** How old the anchor sale is, in days. 3650 when undated/absent. */
  anchorAgeDays: number;
  /**
   * True when the anchor is older than STALE_ANCHOR_DAYS. A stale print is
   * still the best single datum we have, but it is NOT a current price — the
   * range widens and the narration must say how old it is.
   */
  anchorIsStale: boolean;
}

/** Past this age a single sale stops being a "current" price. */
export const STALE_ANCHOR_DAYS = 90;

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
 * Half-width of the anchor-and-adjust range. One sale print gets less
 * representative the older it is, so the band widens with age — a 10-month-old
 * anchor quoted at +/-8% reads as a live price when it isn't. An index
 * adjustment already corrects for drift, so it earns back half the widening.
 */
export const anchorBand = (ageDays: number, hasIndex: boolean): number => {
  const base =
    ageDays <= 30
      ? 0.08
      : ageDays <= 90
        ? 0.1
        : ageDays <= 180
          ? 0.15
          : ageDays <= 365
            ? 0.22
            : 0.3;
  return hasIndex ? 0.08 + (base - 0.08) / 2 : base;
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
    // Say "stale" out loud — a bare date reads as current to both the model
    // narrating this and the admin reading it.
    const stale =
      opts.dLastDays > STALE_ANCHOR_DAYS && opts.dLastDays < 3650
        ? ' — STALE, not a current price'
        : '';
    basis = `anchored on last sale (${ageTxt})${opts.hasIndex ? ', index-adjusted' : ''}${stale}`;
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

  // Anchor = the NEWEST dated sale we have, chosen in CODE. We do NOT trust the
  // model's anchor pick — it has grabbed stale mid-pack comps before. Merge the
  // model's anchorComp into the candidate set but let recency decide.
  const anchorCandidates = [
    ...(input.anchorComp && isPricingComp(input.anchorComp)
      ? [input.anchorComp]
      : []),
    ...pricing,
  ].sort(
    (a, b) => daysBetween(a.date, input.today) - daysBetween(b.date, input.today),
  );
  const anchor: ValComp | null = anchorCandidates[0] ?? null;
  const anchorAgeDays = anchor ? daysBetween(anchor.date, input.today) : 3650;
  const anchorIsStale = anchorAgeDays > STALE_ANCHOR_DAYS;

  if (input.method === 'anchor-and-adjust') {
    if (anchor) {
      const move = input.indexMovePct ?? 0;
      point = anchor.priceUsd * (1 + move / 100);
      const h = anchorBand(anchorAgeDays, input.indexMovePct != null);
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

  const single = input.method === 'anchor-and-adjust' && nRecent <= 1;
  const conf = computeConfidence({
    method: input.method,
    nRecent,
    // When we anchor, the anchor's own age is what the estimate rides on —
    // pricing[0] can be a different comp than the one we anchored on.
    dLastDays:
      input.method === 'anchor-and-adjust' && anchor ? anchorAgeDays : dLast,
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
    anchor,
    anchorAgeDays,
    anchorIsStale: !!anchor && anchorIsStale,
  };
};
