/**
 * Spike Radar — the pure (no I/O) pieces of early spike detection, kept apart
 * from the pipeline in market-heat.service.ts so they're unit-testable:
 *
 *  - parseVariant: break a broad topic's listing titles ("LeBron Prizm") down
 *    into specific cards (year · number · parallel · grade).
 *  - scoreSpike: score a topic's latest readings against its OWN history, so
 *    a move that's normal for one card but unusual for another is caught.
 *  - variantMove: is one specific card inside a topic lighting up?
 */

// ------------------------------------------------------------------ tuning ----

/** Changes are measured against the latest snapshot at least this old (~a day). */
export const BASELINE_MIN_AGE_HOURS = 20;
/** Daily readings needed before a topic is judged against its own normal. */
export const MIN_HISTORY = 5;
/** A signal "fires" at this many standard deviations above its normal. */
export const FIRE_Z = 2;
/** How many of the cheapest listings each snapshot remembers for sweep checks. */
export const CHEAP_SAMPLE = 10;
/** How long a flagged topic stays in hourly watch mode. */
export const WATCH_HOURS_FLAGGED = 48;
export const WATCH_HOURS_DISCOVERED = 72;
/** Max topics snapshotted per hourly watch run (eBay allows ~5,000 calls/day). */
export const WATCH_CAP = 120;
/** Auto-discovery limits, so a noisy day can't flood the taxonomy. */
export const AUTO_PROMOTE_PER_DAY = 10;
export const AUTO_NODES_MAX = 150;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------- variant parsing ----

/**
 * Parallel / finish / edition words that make two copies of "the same card"
 * different cards to a buyer. Multi-word phrases first so "reverse holo"
 * wins over "holo".
 */
const PARALLELS: { re: RegExp; tag: string }[] = [
  { re: /\breverse holo\b/, tag: 'reverse holo' },
  { re: /\b(1st|first) edition\b/, tag: '1st edition' },
  { re: /\balt(ernate)? art\b/, tag: 'alt art' },
  { re: /\bfull art\b/, tag: 'full art' },
  { re: /\bspecial illustration\b/, tag: 'special illustration' },
  { re: /\bsecret rare\b/, tag: 'secret rare' },
  { re: /\bcracked ice\b/, tag: 'cracked ice' },
  { re: /\bcolor blast\b/, tag: 'color blast' },
  { re: /\bextended art\b/, tag: 'extended art' },
  { re: /\bcase hit\b/, tag: 'case hit' },
  { re: /\bshadowless\b/, tag: 'shadowless' },
  { re: /\bholo\b/, tag: 'holo' },
  { re: /\b(refractor|xfractor)\b/, tag: 'refractor' },
  { re: /\bmojo\b/, tag: 'mojo' },
  { re: /\bshimmer\b/, tag: 'shimmer' },
  { re: /\bdisco\b/, tag: 'disco' },
  { re: /\bhyper\b/, tag: 'hyper' },
  { re: /\bdowntown\b/, tag: 'downtown' },
  { re: /\bkaboom\b/, tag: 'kaboom' },
  { re: /\benchanted\b/, tag: 'enchanted' },
  { re: /\bmanga\b/, tag: 'manga' },
  { re: /\bborderless\b/, tag: 'borderless' },
  { re: /\bshowcase\b/, tag: 'showcase' },
  { re: /\b(foil)\b/, tag: 'foil' },
  { re: /\b(auto|autograph|autographed)\b/, tag: 'auto' },
  { re: /\b(patch|rpa)\b/, tag: 'patch' },
  { re: /\bssp\b/, tag: 'ssp' },
  { re: /\bsilver\b/, tag: 'silver' },
  { re: /\bgold\b/, tag: 'gold' },
  { re: /\bred\b/, tag: 'red' },
  { re: /\bblue\b/, tag: 'blue' },
  { re: /\bgreen\b/, tag: 'green' },
  { re: /\borange\b/, tag: 'orange' },
  { re: /\bpurple\b/, tag: 'purple' },
  { re: /\bpink\b/, tag: 'pink' },
  { re: /\bblack\b/, tag: 'black' },
  { re: /\bjapanese\b/, tag: 'japanese' },
  { re: /\bkorean\b/, tag: 'korean' },
  { re: /\bchinese\b/, tag: 'chinese' },
];

/** Words that describe a numbered TCG card rather than make it a different one. */
const DESCRIPTIVE = new Set([
  'holo',
  'alt art',
  'full art',
  'secret rare',
  'special illustration',
]);

/** Lots, pick-your-own, breaks and fakes aren't one card — skip them. */
const JUNK =
  /\b(lot|lots|you pick|pick your|choose|complete set|bundle|proxy|custom|orica|reprint|digital|case break|break spot|mystery|repack|random|code card)\b/;

export interface ParsedVariant {
  /** Stable key for grouping (lowercase, pipe-joined). */
  signature: string;
  /** Human label, e.g. "2012 #1 Silver · PSA 10". */
  label: string;
  /** Extra eBay search words that pin this exact card down. */
  queryTerms: string;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Turn one listing title into a specific-card identity, or null when it can't
 * be pinned down (no card number) or isn't a single card (lots, breaks…).
 * `sports` changes how "12/99" reads: a serial number there, a set number
 * ("215/203") in TCGs.
 */
export function parseVariant(
  rawTitle: string | null | undefined,
  opts: { sports: boolean },
): ParsedVariant | null {
  if (!rawTitle) return null;
  let t = ` ${rawTitle.toLowerCase().replace(/\s+/g, ' ')} `;
  if (JUNK.test(t)) return null;

  // Grade first, so "PSA 10" can't be read as a card number.
  let grade = 'raw';
  const g = t.match(/\b(psa|bgs|cgc|sgc|tag)\s*-?\s*(10|[1-9](?:\.5)?)\b/);
  if (g) {
    grade = `${g[1]} ${g[2]}`;
    t = t.replace(g[0], ' ');
  }

  const yr = t.match(/\b(19[4-9]\d|20[0-4]\d)(?:[-/]\d{2})?\b/);
  const year = yr ? yr[1] : '';
  if (yr) t = t.replace(yr[0], ' ');

  let serial = '';
  let number = '';
  if (opts.sports) {
    // Serial-numbered: "/99", "#/25", "12/99" (copy 12 of 99).
    const s = t.match(/(?:#|\b\d{1,4}|\s)\s*\/\s*(\d{1,4})\b/);
    if (s) {
      serial = `/${parseInt(s[1], 10)}`;
      t = t.replace(s[0], ' ');
    }
    const n = t.match(/#\s?([a-z]{0,5}-?\d{1,4}[a-z]?)\b/);
    if (n) number = `#${n[1]}`;
  } else {
    // TCG set numbering: "215/203", "4/102".
    const n = t.match(/\b(\d{1,3})\s*\/\s*(\d{2,3})\b/);
    if (n) number = `${parseInt(n[1], 10)}/${parseInt(n[2], 10)}`;
    // Set-code numbering: "OP09-119", "ST01-012", "SWSH050", "SVP 085".
    if (!number) {
      const c =
        t.match(/\b([a-z]{1,4}\d{1,3}-\d{2,3})\b/) ??
        t.match(/\b(swsh|svp|sv|sm|xy|bw)\s?(\d{2,3})\b/);
      if (c) number = c[2] ? `${c[1]}${c[2]}` : c[1];
    }
    if (!number) {
      const h = t.match(/#\s?(\d{1,4})\b/);
      if (h) number = `#${h[1]}`;
    }
  }
  if (!number) return null;

  let tags: string[] = [];
  let rest = t;
  for (const p of PARALLELS) {
    if (p.re.test(rest)) {
      tags.push(p.tag);
      rest = rest.replace(p.re, ' ');
    }
  }
  // An "a/b" set number (Pokémon, Lorcana) already IS the card, and sellers
  // add the year or "holo"/"alt art" inconsistently — keeping them would split
  // one card into several groups. Set codes (One Piece) are different: a
  // parallel shares its number with the base card, so tags must stay.
  let cardYear = year;
  if (!opts.sports && /^\d+\/\d+$/.test(number)) {
    cardYear = '';
    tags = tags.filter((x) => !DESCRIPTIVE.has(x));
  }
  tags.sort();

  const signature = [cardYear, number, ...tags, serial, grade]
    .filter(Boolean)
    .join('|');
  const label = [cardYear, number.toUpperCase(), ...tags.map(titleCase), serial]
    .filter(Boolean)
    .join(' ')
    .concat(grade === 'raw' ? ' · Raw' : ` · ${grade.toUpperCase()}`);
  const queryTerms = [
    cardYear,
    number,
    ...tags,
    serial,
    grade === 'raw' ? '' : grade,
  ]
    .filter(Boolean)
    .join(' ');
  return { signature, label, queryTerms };
}

// ----------------------------------------------------------- spike scoring ----

export type SpikeKey =
  | 'floor'
  | 'sweep'
  | 'supply'
  | 'sellThrough'
  | 'price'
  | 'buzz'
  | 'tracking';

/** One topic's readings at one snapshot (all vs ~a day earlier). */
export interface SpikeInputs {
  floorChangePct: number | null;
  sweptPct: number | null;
  totalActiveChangePct: number | null;
  clearedRatePct: number | null;
  askChangePct: number | null;
  socialMentions: number | null;
  firstPartyAdds: number | null;
}

export interface SpikeSignal {
  key: SpikeKey;
  /** Today's reading. */
  value: number;
  /** How unusual it is, in the hot direction (≥ FIRE_Z = firing). */
  z: number;
  firing: boolean;
  /** This topic's typical reading, when it has enough history. */
  typical: number | null;
}

export interface SpikeResult {
  /** 0-100: how strongly several signals are spiking at once. */
  score: number;
  firing: number;
  /** Worth a look: two+ signals firing, or one overwhelming move. */
  flagged: boolean;
  signals: SpikeSignal[];
  /** Judged against fixed thresholds, not yet against its own history. */
  coldStart: boolean;
}

interface SpikeSpec {
  key: SpikeKey;
  pick: (x: SpikeInputs) => number | null;
  /** +1 = higher is hotter, -1 = lower is hotter (supply). */
  dir: 1 | -1;
  /** Smallest spread we'll divide by, so a flat history can't make noise look huge. */
  minStd: number;
  /** With no history: the reading that counts as a firing (z = 2) move. Null = needs history. */
  absolute: number | null;
}

const SPECS: SpikeSpec[] = [
  {
    key: 'floor',
    pick: (x) => x.floorChangePct,
    dir: 1,
    minStd: 3,
    absolute: 15,
  },
  { key: 'sweep', pick: (x) => x.sweptPct, dir: 1, minStd: 10, absolute: 50 },
  {
    key: 'supply',
    pick: (x) => x.totalActiveChangePct,
    dir: -1,
    minStd: 1.5,
    absolute: 5,
  },
  {
    key: 'sellThrough',
    pick: (x) => x.clearedRatePct,
    dir: 1,
    minStd: 5,
    absolute: 40,
  },
  {
    key: 'price',
    pick: (x) => x.askChangePct,
    dir: 1,
    minStd: 3,
    absolute: 10,
  },
  {
    key: 'buzz',
    pick: (x) => x.socialMentions,
    dir: 1,
    minStd: 3,
    absolute: null,
  },
  {
    key: 'tracking',
    pick: (x) => x.firstPartyAdds,
    dir: 1,
    minStd: 1,
    absolute: 3,
  },
];

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(
    xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length - 1),
  );
};

/**
 * Score one snapshot against the topic's own history (prior daily readings,
 * oldest first). Each signal becomes a z-score in its hot direction; only
 * clearly unusual moves (z ≥ 1) add to the score, so everyday noise across
 * seven signals can't sum into a false alarm.
 */
export function scoreSpike(
  cur: SpikeInputs,
  history: SpikeInputs[],
): SpikeResult {
  const signals: SpikeSignal[] = [];
  let coldStart = false;
  for (const s of SPECS) {
    const v = s.pick(cur);
    if (v == null || !Number.isFinite(v)) continue;
    const past = history
      .map(s.pick)
      .filter((x): x is number => x != null && Number.isFinite(x));
    let z: number;
    let typical: number | null = null;
    if (past.length >= MIN_HISTORY) {
      const m = mean(past);
      // Buzz is a level, so let its noise floor scale with how loud it usually is.
      const floor = s.key === 'buzz' ? Math.max(s.minStd, m * 0.25) : s.minStd;
      z = (s.dir * (v - m)) / Math.max(std(past), floor);
      typical = round1(m);
    } else if (s.absolute != null) {
      coldStart = true;
      z = ((s.dir * v) / s.absolute) * FIRE_Z;
    } else {
      continue;
    }
    // A sweep only means something if the cheap end is clearing faster than
    // the listings overall (otherwise it's just Best-Match churn).
    if (
      s.key === 'sweep' &&
      cur.clearedRatePct != null &&
      v < cur.clearedRatePct * 1.5
    ) {
      z = Math.min(z, 1);
    }
    z = round1(clamp(z, -4, 4));
    signals.push({
      key: s.key,
      value: round1(v),
      z,
      firing: z >= FIRE_Z,
      typical,
    });
  }
  const firing = signals.filter((x) => x.firing).length;
  const sum = signals.reduce((acc, x) => acc + (x.z >= 1 ? x.z : 0), 0);
  const score = Math.round(clamp((sum / 10) * 100, 0, 100));
  return {
    score,
    firing,
    flagged: firing >= 2 || score >= 60,
    signals,
    coldStart,
  };
}

// --------------------------------------------------------- variant movement ----

export interface VariantReading {
  listedCount: number;
  floorUsd: number | null;
  /** Of this card's listings that were live a day ago, how many are gone now. */
  clearedCount: number;
}

/**
 * Is one specific card inside a topic lighting up? Needs a few copies a day
 * ago to compare against; then either its floor jumped while copies sold, or
 * half its copies cleared out.
 */
export function variantMove(
  cur: VariantReading,
  base: { listedCount: number; floorUsd: number | null } | null,
): {
  floorChangePct: number | null;
  countChangePct: number | null;
  hot: boolean;
} {
  if (!base || base.listedCount <= 0)
    return { floorChangePct: null, countChangePct: null, hot: false };
  const floorChangePct =
    base.floorUsd && cur.floorUsd
      ? round1(((cur.floorUsd - base.floorUsd) / base.floorUsd) * 100)
      : null;
  const countChangePct = round1(
    ((cur.listedCount - base.listedCount) / base.listedCount) * 100,
  );
  const hot =
    base.listedCount >= 3 &&
    ((floorChangePct != null &&
      floorChangePct >= 20 &&
      cur.clearedCount >= 1) ||
      (cur.clearedCount >= 3 && cur.clearedCount / base.listedCount >= 0.5));
  return { floorChangePct, countChangePct, hot };
}
