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
 * How an ANALOG relates to the card being valued, strongest evidence first.
 *
 * This ladder exists so triangulation is a method rather than a vibe. Some
 * cards genuinely cannot be comped — a 1/1, a fresh release, a pop-1 slab that
 * has never traded — and for those the honest answer is not "no idea", it is
 * "here is the nearest thing that DID sell and what it implies". Naming the
 * relationship makes the estimate auditable: you can see it came from the PSA 9
 * of the same card rather than from thin air.
 */
export type AnalogRelation =
  | 'same-card-adjacent-grade'
  | 'same-card-raw-vs-graded'
  | 'sibling-parallel'
  | 'same-subject-comparable-print'
  | 'same-set-comparable-tier'
  | 'scarcity-scaled';

/**
 * Evidential strength per rung, 0-1. Drives confidence only — never the price.
 * The PSA 9 of the exact same card tells you far more about the PSA 10 than a
 * different player's card from the same set does.
 */
export const ANALOG_STRENGTH: Record<AnalogRelation, number> = {
  'same-card-adjacent-grade': 1.0,
  'same-card-raw-vs-graded': 0.85,
  'sibling-parallel': 0.75,
  'same-subject-comparable-print': 0.6,
  'same-set-comparable-tier': 0.45,
  'scarcity-scaled': 0.4,
};

/**
 * A comparable that is NOT this card — a real sale of something related, plus
 * the multiplier that carries it across to the subject. Kept separate from
 * ValComp so an analog can never be mistaken for a direct comp of this card.
 */
export interface ValAnalog {
  /** The analog's own title, verbatim — e.g. "…Mahomes Color Blast PSA 9". */
  title: string;
  /** What the ANALOG sold for. */
  priceUsd: number;
  date: string | null;
  relation: AnalogRelation | string;
  /** subject ≈ priceUsd × multiplier. e.g. PSA 9 → PSA 10 might be 2.5. */
  multiplier: number;
  /** Why this multiplier, in a few words. */
  rationale: string | null;
  url: string | null;
}

/** Multipliers outside this range are extraction noise, not market reality. */
const MULTIPLIER_MIN = 0.01;
const MULTIPLIER_MAX = 100;

/** An analog only counts if it has a real price, a sane multiplier and a source. */
export const isUsableAnalog = (a: ValAnalog): boolean =>
  !!a &&
  typeof a.priceUsd === 'number' &&
  a.priceUsd > 0 &&
  typeof a.multiplier === 'number' &&
  Number.isFinite(a.multiplier) &&
  a.multiplier >= MULTIPLIER_MIN &&
  a.multiplier <= MULTIPLIER_MAX &&
  !!a.url;

/** What the subject would be worth if this analog's relationship holds. */
export const impliedValue = (a: ValAnalog): number => a.priceUsd * a.multiplier;

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
  /** Comparable-but-different cards, for when this one can't be comped. */
  analogsUsed?: ValAnalog[];
  /** Model's own point/range — used only when nothing at all was retrieved. */
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
   * The anchor is far off the other comps (>3x or <1/3 their median).
   *
   * We deliberately no longer DELETE extreme prices — card prices spike, and a
   * record sale is often the most important comp there is. But an anchor that
   * is wildly out of line might equally be a mis-scrape, so we say so instead
   * of silently presenting it as the market. Null when there aren't enough
   * other comps to judge against.
   */
  anchorIsExtreme: boolean;
  /**
   * True when the anchor is older than STALE_ANCHOR_DAYS. A stale print is
   * still the best single datum we have, but it is NOT a current price — the
   * range widens and the narration must say how old it is.
   */
  anchorIsStale: boolean;
  /** The analogs that actually backed a triangulated estimate. */
  analogsUsed: ValAnalog[];
}

/** Past this age a single sale stops being a "current" price. */
export const STALE_ANCHOR_DAYS = 90;

/**
 * How far off the other comps an anchor has to sit before we call it out.
 * Only ever produces a WARNING — extreme prices are kept, because spikes are
 * real and deleting them understates the card.
 */
export const EXTREME_ANCHOR_RATIO = 3;

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
  /** Triangulation only: how many analogs backed the estimate. */
  nAnalogs?: number;
  /** Triangulation only: the strongest analog relationship used. */
  bestAnalog?: string;
  /** Triangulation only: strength of that relationship, 0-1. */
  analogStrength?: number;
}): { pct: number; basis: string } => {
  const R = recencyFactor(opts.dLastDays);
  const C = countFactor(opts.nRecent);
  const D = dispersionFactor(opts.cv, opts.single || opts.method === 'triangulation');
  let pct = Math.round(100 * (0.35 * R + 0.3 * C + 0.35 * D));
  if (opts.method === 'anchor-and-adjust' && opts.hasIndex) pct += 6;
  pct = clamp(pct, 20, 98);
  if (opts.method === 'triangulation') {
    // An estimate built from the PSA 9 of the SAME card deserves more credit
    // than one built from a different player's card — but never as much as a
    // real sale of the card itself, so the hard cap stays.
    const strength = opts.analogStrength ?? 0;
    const backed = Math.min(opts.nAnalogs ?? 0, 4) / 4;
    pct = Math.round(28 + 27 * (0.6 * strength + 0.4 * backed));
    pct = Math.min(pct, 55);
  }

  const spread =
    opts.nRecent >= 2 ? ` spread +-${Math.round(opts.cv * 100)}%` : '';
  const recency =
    opts.dLastDays >= 3650 ? 'no dated comp' : `newest ${opts.dLastDays}d ago`;
  let basis: string;
  if (opts.method === 'triangulation') {
    basis = opts.nAnalogs
      ? `estimated from ${opts.nAnalogs} comparable card${opts.nAnalogs === 1 ? '' : 's'} (${opts.bestAnalog ?? 'analog'}) — no direct comps for this exact card`
      : 'triangulated estimate — no direct comps';
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
  const analogs = (input.analogsUsed ?? []).filter(isUsableAnalog);
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

  // Flag — never drop — an anchor that sits far off the rest. Needs at least
  // two other comps before "far off the rest" means anything.
  // Compare against EVERY sale comp, not just `pricing` — that set narrows to
  // the last 90 days, so the moment one recent sale exists the whole trading
  // history drops out of it and there is nothing left to judge "extreme"
  // against. The historical cluster is precisely the reference we need.
  const otherPrices = anchor
    ? comps.filter((c) => !isSameComp(c, anchor)).map((c) => c.priceUsd)
    : [];
  const medianOthers = otherPrices.length >= 2 ? median(otherPrices) : NaN;
  const anchorIsExtreme =
    !!anchor &&
    Number.isFinite(medianOthers) &&
    medianOthers > 0 &&
    (anchor.priceUsd > medianOthers * EXTREME_ANCHOR_RATIO ||
      anchor.priceUsd < medianOthers / EXTREME_ANCHOR_RATIO);

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

  // Triangulation: price it from the ANALOGS in code, the same way the other
  // two routes are computed. Previously this route just adopted the model's
  // own number, which made it the one place a price wasn't derived from
  // recorded evidence.
  if (point == null && analogs.length > 0) {
    const implied = analogs.map(impliedValue);
    point = trimmedMedian(implied);
    // Spread across the analogs IS the uncertainty, floored at +/-25% because
    // agreement between two guesses is not precision.
    const lo = Math.min(...implied);
    const hi = Math.max(...implied);
    low = Math.min(lo, point * 0.75);
    high = Math.max(hi, point * 1.25);
  }

  // Nothing retrieved at all → fall back to the model's own estimate so a
  // thin answer is still an answer.
  if (point == null) {
    point = input.modelPoint;
    low = input.modelLow;
    high = input.modelHigh;
  }

  // Strongest rung the analogs reached — drives triangulation confidence.
  const bestAnalog = analogs.reduce<{ relation: string; strength: number }>(
    (best, a) => {
      const s = ANALOG_STRENGTH[a.relation as AnalogRelation] ?? 0.35;
      return s > best.strength
        ? { relation: String(a.relation), strength: s }
        : best;
    },
    { relation: '', strength: 0 },
  );

  const single = input.method === 'anchor-and-adjust' && nRecent <= 1;
  const conf = computeConfidence({
    nAnalogs: analogs.length,
    bestAnalog: bestAnalog.relation || undefined,
    analogStrength: bestAnalog.strength,
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

  // Say it in the basis so the number is never presented as unremarkable.
  const basis = anchorIsExtreme
    ? `${conf.basis} — anchor is ${(anchor!.priceUsd / medianOthers).toFixed(1)}x the median of the other comps, worth verifying`
    : conf.basis;

  const round2 = (n: number | null) =>
    n == null ? null : Math.round(n * 100) / 100;

  return {
    pointUsd: round2(point),
    lowUsd: round2(low),
    highUsd: round2(high),
    confidencePct: conf.pct,
    confidenceBasis: basis,
    pricingComps: pricing,
    anchor,
    anchorAgeDays,
    anchorIsStale: !!anchor && anchorIsStale,
    anchorIsExtreme,
    analogsUsed: analogs,
  };
};
