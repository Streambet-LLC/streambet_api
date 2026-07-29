import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../../integrations/ai/ai.service';
import { CardValuationSnapshot } from '../entities/card-valuation-snapshot.entity';
import {
  ValAnalog,
  ValComp,
  ValMethod,
  computeValuation,
  isSameComp,
} from './valuation.util';
import { PokemonPriceSource } from './pokemon-price.source';
import { UserCompsService } from './user-comps.service';
import { EbayBrowseSource } from './ebay-browse.source';

/** One point in a card's valuation history. */
export interface ValuationHistoryPoint {
  at: string;
  pointUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  confidencePct: number | null;
}

/** How trustworthy the valuation is, for the honesty gate. */
export type Reliability = 'grounded' | 'thin' | 'unverified';

/** The code-computed valuation returned to the chat/report layer. */
export interface CardValuation {
  isCard: boolean;
  subject: string;
  method: ValMethod;
  pointUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  /** Deterministic, evidence-tied confidence (computed, not model-picked). */
  confidencePct: number;
  confidenceBasis: string;
  anchorComp: ValComp | null;
  /** Age of the anchor sale in days, as of the valuation run. */
  anchorAgeDays: number | null;
  /**
   * The anchor is older than 90 days — it is the best single datum we have but
   * NOT a current price. Consumers must state the age and avoid "fresh"/"just
   * sold" framing.
   */
  anchorIsStale: boolean;
  /** Sale comps that actually counted toward the price, newest-first. */
  compsUsed: ValComp[];
  /**
   * Comparable-but-different cards backing a TRIANGULATED estimate, each with
   * the multiplier used. Empty unless method === 'triangulation'. These are
   * NOT sales of this card — never present them as comps.
   */
  analogsUsed: ValAnalog[];
  indexAdjustment: { index: string; movePct: number; window: string } | null;
  /**
   * Live eBay ACTIVE-listing context (asks, not sold comps) — a lowest-ask
   * ceiling + liquidity signal + shop link. Never the valuation price.
   */
  marketContext: {
    source: string;
    activeCount: number;
    lowestAskUsd: number | null;
    url: string;
  } | null;
  /**
   * The honesty gate: 'grounded' = real recent comps, trust the number;
   * 'thin' = few/old/index-only, hedge; 'unverified' = no direct evidence,
   * labeled estimate only.
   */
  reliability: Reliability;
  liquidity: string | null;
  trajectory: string | null;
  take: string | null;
  note: string | null;
  sources: { title: string; type?: string; url: string }[];
}

/** Raw structured extraction the model returns (NO computed point/confidence). */
interface RawValuation {
  isCard?: boolean;
  method?: string;
  anchorComp?: Partial<ValComp> | null;
  compsUsed?: Partial<ValComp>[];
  analogsUsed?: Partial<ValAnalog>[];
  indexAdjustment?: { index?: string; movePct?: number; window?: string } | null;
  estimate?: { pointUsd?: number; lowUsd?: number; highUsd?: number } | null;
  liquidity?: string;
  trajectory?: string;
  take?: string;
  note?: string;
  sources?: { title?: string; type?: string; url?: string }[];
}

const METHODS: ValMethod[] = [
  'anchor-and-adjust',
  'recent-median',
  'triangulation',
];

/**
 * Structured, code-grounded card valuation. The model RETRIEVES the evidence
 * (comps, anchor sale, index move) via live web search; this service does the
 * arithmetic and confidence scoring in code (valuation.util) so the numbers are
 * deterministic and can't be hallucinated. Powers the chat `value_card` tool
 * and can back the deep-dive valuation.
 */
@Injectable()
export class ValuationService {
  private readonly logger = new Logger(ValuationService.name);
  /** Cache so the same card asked twice gives the SAME number — and so a
   *  pre-warmed demo card returns instantly. Sized for a demo session. */
  private readonly cache = new Map<string, { at: number; value: CardValuation }>();
  private readonly CACHE_TTL_MS = 3 * 60 * 60 * 1000;

  /** Demo-friendly cards to pre-warm before a live session (liquid, clean
   *  comps that value reliably). Hitting /valuation/warm caches these. */
  static readonly SHOWCASE_SUBJECTS = [
    '2019 Panini Prizm Color Blast Patrick Mahomes PSA 10',
    '2025 Panini Absolute Kaboom Luther Burden III PSA 10',
    '2023 Pokemon 151 Charizard ex Special Illustration Rare #199 PSA 10',
    '2016 Pokemon XY Evolutions Charizard Holo #11 PSA 10',
    '2018 Panini Prizm Luka Doncic Silver PSA 10',
    '1999 Pokemon Base Set Charizard #4 PSA 9',
  ];

  constructor(
    private readonly ai: AiService,
    private readonly pokemon: PokemonPriceSource,
    private readonly ebay: EbayBrowseSource,
    private readonly userComps: UserCompsService,
    @InjectRepository(CardValuationSnapshot)
    private readonly snapshots: Repository<CardValuationSnapshot>,
  ) {}

  isConfigured(): boolean {
    return this.ai.isConfigured();
  }

  /**
   * Drop the cached valuation for a card. Called when the evidence changes
   * underneath it — e.g. the user supplies a comp we missed — because the
   * cached number was computed without that sale and would otherwise be
   * served for up to 3 hours, making their correction look ignored.
   */
  invalidate(subject: string): void {
    this.cache.delete((subject ?? '').trim().toLowerCase());
  }

  /**
   * Kept deliberately TIGHT. This prompt had accreted to ~5,000 chars across
   * many fixes — "newest" appeared 15 times, "title" 39 — and that weight was
   * itself the problem: more instructions meant more thinking and more output,
   * which pushed an interactive call past its timeout and returned nothing at
   * all. Every guarantee below is load-bearing and stated exactly once. Before
   * adding to it, check the rule is not already here in other words.
   */
  private readonly SYSTEM =
    'You are a trading-card valuation RESEARCHER. You RETRIEVE market evidence for ONE card and return structured JSON. You do NOT compute the final price or confidence — the app does that from your evidence. Output ONLY the JSON object. ' +
    'GROUNDING: never report a price you did not retrieve this run. Every comp needs a real retrieved url and a date (YYYY-MM-DD). Type each source as exactly one of auction-sale, private-sale, marketplace-listing (an ask, NOT a sale), price-guide, index. ' +
    'TITLE: set "title" to the title of that sale row, verbatim from the page. It is the only way to tell parallels apart when rows share one url — if a title shows a different item (other insert/parallel/player/year/grade, or a multi-card lot), leave the row out. If a title is unreadable, still report the row with title null. ' +
    'RECENCY IS THE PRIORITY: for a graded card, open the PSA sales-history page for that exact spec and read it TOP-DOWN, newest first. Return up to 10 sales in newest-first order. Never return a "representative sample" spread across years, and never present an older sale as the latest when newer rows exist on the page. Missing a recent sale is the worst error you can make here. ' +
    'WHERE THE NEWEST HIGH-VALUE SALES LIVE: for pricey cards the latest sale is often NOT on eBay — it is on Fanatics Collect (fanaticscollect.com), Goldin, Heritage, or PWCC. Search those auction venues and Card Ladder / PSA sales-history for the most recent sale too; NEVER assume the newest eBay sale is the newest sale overall (a Fanatics Collect auction can be weeks newer and much higher). ' +
    'KEEP EXTREMES: never omit a sale because its price is far above or below the others — spikes are real, and a record sale is usually the most important comp. Only identity (the title) justifies dropping a row. ' +
    'PICK THE ROUTE: (1) many recent exact SOLD comps, usually eBay -> "recent-median". (2) few but real sales, usually on the PSA page -> "anchor-and-adjust": fill compsUsed newest-first, set anchorComp to the newest, and add the relevant player/segment index move since that date as indexAdjustment. (3) no direct comps for this exact card (a 1/1, a brand-new release, one that has never traded) -> "triangulation": leave compsUsed empty and fill analogsUsed with REAL retrieved sales of the nearest comparable cards, each with the multiplier that carries it to the subject. Prefer in order: same card adjacent grade > same card raw-vs-graded > sibling parallel > same subject comparable print > same set similar tier > numbered sibling scaled for scarcity. Every analog needs a real url — an analog you did not find is a fabrication.';

  private readonly SCHEMA = `Return ONLY this JSON (no prose, no code fences):
{
  "isCard": <boolean>,
  "method": "recent-median" | "anchor-and-adjust" | "triangulation",
  "anchorComp": { "priceUsd": <number>, "date": "<YYYY-MM-DD>", "title": "<the sale's own title, verbatim from the page>", "grade": "<e.g. PSA 10>", "sourceType": "auction-sale"|"private-sale", "url": "<retrieved url>" } | null,
  "compsUsed": [ { "priceUsd": <number>, "date": "<YYYY-MM-DD>", "title": "<the sale's own title, verbatim from the page>", "grade": "<e.g. PSA 10>", "sourceType": "auction-sale"|"private-sale"|"marketplace-listing"|"price-guide"|"index", "url": "<retrieved url>" } ],
  "indexAdjustment": { "index": "<e.g. Card Ladder Patrick Mahomes>", "movePct": <signed number, e.g. -6.3>, "window": "<since the anchor date>" } | null,
  "analogsUsed": [ { "title": "<the analog's own title, verbatim>", "priceUsd": <what the ANALOG sold for>, "date": "<YYYY-MM-DD>", "relation": "same-card-adjacent-grade"|"same-card-raw-vs-graded"|"sibling-parallel"|"same-subject-comparable-print"|"same-set-comparable-tier"|"scarcity-scaled", "multiplier": <number: subject ≈ priceUsd × multiplier>, "rationale": "<why this multiplier, a few words>", "url": "<retrieved url>" } ],
  "estimate": { "pointUsd": <number>, "lowUsd": <number>, "highUsd": <number> } | null,
  "liquidity": "High" | "Medium" | "Low",
  "trajectory": "Rising" | "Stable" | "Falling",
  "take": "<one-sentence sell/hold read>",
  "note": "<optional one line, or null>",
  "sources": [ { "title": "<source>", "type": "auction-sale"|"private-sale"|"marketplace-listing"|"price-guide"|"index"|"news", "url": "<retrieved url>" } ]
}`;

  /** Value ONE card by subject: retrieve evidence → compute in code. */
  async valueCard(
    subject: string,
    adminId?: string,
    /**
     * Skip the cache read and research from scratch. Set when the user
     * explicitly asks to re-run/refresh, or disputes the result — otherwise
     * "run it again" replayed the same cached answer for up to 3 hours and
     * looked like nothing happened.
     */
    forceRefresh = false,
  ): Promise<CardValuation> {
    const clean = (subject ?? '').trim().slice(0, 300);
    const today = new Date().toISOString().slice(0, 10);
    const empty: CardValuation = {
      isCard: false,
      subject: clean,
      method: 'triangulation',
      pointUsd: null,
      lowUsd: null,
      highUsd: null,
      confidencePct: 20,
      confidenceBasis: 'no evidence retrieved',
      anchorComp: null,
      anchorAgeDays: null,
      anchorIsStale: false,
      compsUsed: [],
      analogsUsed: [],
      indexAdjustment: null,
      marketContext: null,
      reliability: 'unverified',
      liquidity: null,
      trajectory: null,
      take: null,
      note: null,
      sources: [],
    };
    if (!clean || !this.ai.isConfigured()) return empty;

    // Serve a recent identical valuation so a demo card is CONSISTENT.
    const cacheKey = clean.toLowerCase();
    const hit = this.cache.get(cacheKey);
    if (!forceRefresh && hit && Date.now() - hit.at < this.CACHE_TTL_MS) {
      return hit.value;
    }
    if (forceRefresh) this.cache.delete(cacheKey);

    // Phase timings — a pricing answer is slow enough that "where did the time
    // go" has to be answerable from the logs rather than guessed at.
    const t0 = Date.now();
    const marks: Record<string, number> = {};
    const mark = (phase: string, since: number) => {
      marks[phase] = Date.now() - since;
    };

    // Live eBay asks don't depend on the comps, so start them NOW and collect
    // the result after the research — it used to run strictly afterwards and
    // added its latency to the total for no reason.
    const marketCtxPromise = this.ebay.listingContext(clean).catch(() => null);

    // Hard-bound the interactive latency: few searches, few rounds, and an
    // overall abort so the chat can never hang on this tool.
    let raw: RawValuation;
    const ctrl = new AbortController();
    // An abort is no longer total data loss — research() now parses whatever
    // rounds completed — so this is a latency ceiling rather than a cliff.
    const timer = setTimeout(() => ctrl.abort(), 55000);
    const tResearch = Date.now();
    try {
      raw = await this.ai.research<RawValuation>({
        system: this.SYSTEM,
        // Spell out the current YEAR, not just the date. "Today is
        // 2026-07-28" was not enough to stop it treating a 2025 sale as the
        // latest — naming the year makes the check explicit.
        prompt:
          `Card: ${clean}.\nToday is ${today}. The CURRENT YEAR IS ${today.slice(0, 4)} — ` +
          `sales from ${today.slice(0, 4)} very likely exist for this card, and if any do they ` +
          `belong at the top of compsUsed.\n\n${this.SCHEMA}`,
        model: this.ai.chatModel,
        // These exact numbers are the only combination observed to COMPLETE
        // inside the abort on a thin, high-value card. Raising maxSearches to
        // 4, or effort to 'medium', timed out at 55s both times and returned
        // nothing. Do not "restore" them without a measured run to back it up
        // — search latency, not reasoning quality, is the binding constraint
        // here. Extra recall now comes from the trimmed prompt instead.
        maxTokens: 6000,
        maxSearches: 3,
        maxRounds: 3,
        effort: 'low',
        signal: ctrl.signal,
        meta: { feature: 'value_card', adminId },
      });
    } catch (e) {
      // Name the cause explicitly. "unverified, no comps" on screen can mean a
      // timeout, a truncated JSON body, or a genuinely uncomped card, and
      // those need completely different fixes.
      const msg = (e as Error).message ?? '';
      const cause = ctrl.signal.aborted
        ? 'TIMED OUT (raise the abort)'
        : /non-JSON/i.test(msg)
          ? 'TRUNCATED/INVALID JSON (raise maxTokens)'
          : 'research error';
      this.logger.warn(
        `valueCard "${clean}" failed after ${Date.now() - tResearch}ms — ${cause}: ${msg.slice(0, 300)}`,
      );
      return empty;
    } finally {
      clearTimeout(timer);
      mark('research', tResearch);
    }

    const method: ValMethod = METHODS.includes(raw.method as ValMethod)
      ? (raw.method as ValMethod)
      : 'triangulation';
    // Merge in sales the user told us about. These come FIRST so that if the
    // same sale was also retrieved, the dedupe keeps our copy and theirs drops
    // out rather than double-counting it.
    const supplied = await this.userComps.compsFor(clean);
    const extracted = this.cleanComps(raw.compsUsed);
    if (supplied.length) {
      for (const s of supplied) {
        if (!extracted.some((c) => isSameComp(c, s))) extracted.push(s);
      }
      this.logger.log(
        `value_card "${clean}" merged ${supplied.length} user-supplied comp(s)`,
      );
    }
    // Adversarial verify: drop comps that don't hold up as real same-card sales
    // (the anti-phantom / wrong-card guard) before any math anchors on them.
    const tVerify = Date.now();
    // The verifier judges what WE retrieved. A comp the user explicitly
    // pointed us at is not ours to overrule — dropping it would recreate the
    // exact complaint this feature exists to answer.
    const asserted = extracted.filter((c) => c.userSupplied);
    const retrieved = extracted.filter((c) => !c.userSupplied);
    const compsUsed = [
      ...asserted,
      ...(await this.verifyComps(clean, retrieved, adminId)),
    ];
    mark('verify', tVerify);
    const rawAnchor = raw.anchorComp ? this.cleanComp(raw.anchorComp) : null;
    // If the anchor got dropped by the verifier, fall back to the newest kept.
    // Match on the SALE (price+date+url), not the url alone: every row on a PSA
    // sales-history page shares one url, so a url test passes for any comp on
    // the page and would resurrect an anchor the verifier just rejected.
    const anchorComp =
      rawAnchor && compsUsed.some(c => isSameComp(c, rawAnchor))
        ? rawAnchor
        : null;

    const out = computeValuation({
      method,
      anchorComp,
      compsUsed,
      analogsUsed: this.cleanAnalogs(raw.analogsUsed),
      indexMovePct:
        typeof raw.indexAdjustment?.movePct === 'number'
          ? raw.indexAdjustment.movePct
          : null,
      modelPoint: this.num(raw.estimate?.pointUsd),
      modelLow: this.num(raw.estimate?.lowUsd),
      modelHigh: this.num(raw.estimate?.highUsd),
      today,
    });

    let point = out.pointUsd;
    let low = out.lowUsd;
    let high = out.highUsd;
    let confPct = out.confidencePct;
    let confBasis = out.confidenceBasis;
    let note = this.str(raw.note);
    const extraSources: { title: string; type?: string; url: string }[] = [];

    // #4 — real structured data (Pokémon TCG API): a keyless, deterministic
    // fallback/corroboration. Prices are RAW-card, so for a graded slab it's a
    // reference, and for a raw card with no sale comps it becomes the value.
    // Only consult it when the sale comps didn't yield a number (saves latency
    // on already-grounded cards).
    if (
      this.pokemon.isPokemon(clean) &&
      (point == null || method === 'triangulation')
    ) {
      try {
        const sp = await this.pokemon.fetch(clean);
        if (sp) {
          const graded = /\b(psa|bgs|cgc|sgc)\b/i.test(clean);
          if (sp.url) {
            extraSources.push({
              title: sp.label,
              type: 'price-guide',
              url: sp.url,
            });
          }
          if (graded) {
            // Reference only — don't let a raw price masquerade as the slab value.
            const ref = `${sp.label} ${this.money(sp.priceUsd)}${sp.date ? ` (as of ${sp.date})` : ''}`;
            note = note ? `${note} · ${ref}` : ref;
          } else if (point == null) {
            // Raw card, no sale comps → use the real market price as the value.
            point = sp.priceUsd;
            low = Math.round(sp.priceUsd * 85) / 100;
            high = Math.round(sp.priceUsd * 115) / 100;
            confPct = 76;
            confBasis = `${sp.label}${sp.date ? ` as of ${sp.date}` : ''}`;
          }
        }
      } catch {
        /* structured price is best-effort */
      }
    }

    const reliability = this.reliability(point, confPct, out.pricingComps.length);

    // Live eBay active-listing context (asks, not comps) — best-effort, and
    // already in flight since the top of this method.
    const tMarket = Date.now();
    let marketContext: CardValuation['marketContext'] = null;
    const ctx = await marketCtxPromise;
    mark('marketContext', tMarket);
    if (ctx && ctx.activeCount > 0) {
      marketContext = {
        source: 'eBay listings',
        activeCount: ctx.activeCount,
        lowestAskUsd: ctx.lowestAskUsd,
        url: ctx.url,
      };
    }

    const value: CardValuation = {
      isCard: raw.isCard !== false,
      subject: clean,
      method,
      pointUsd: point,
      lowUsd: low,
      highUsd: high,
      confidencePct: confPct,
      confidenceBasis: confBasis,
      anchorComp: out.anchor ?? anchorComp ?? out.pricingComps[0] ?? null,
      anchorAgeDays: out.anchor ? out.anchorAgeDays : null,
      anchorIsStale: out.anchorIsStale,
      compsUsed,
      analogsUsed: out.analogsUsed,
      indexAdjustment:
        raw.indexAdjustment &&
        typeof raw.indexAdjustment.movePct === 'number'
          ? {
              index: String(raw.indexAdjustment.index ?? 'index').slice(0, 80),
              movePct: raw.indexAdjustment.movePct,
              window: String(raw.indexAdjustment.window ?? '').slice(0, 80),
            }
          : null,
      marketContext,
      reliability,
      liquidity: this.str(raw.liquidity),
      trajectory: this.str(raw.trajectory),
      take: this.str(raw.take),
      note,
      sources: [
        ...(Array.isArray(raw.sources)
          ? raw.sources
              .filter(s => s && typeof s.url === 'string')
              .slice(0, 8)
              .map(s => ({
                title: String(s.title ?? 'source').slice(0, 120),
                type: this.str(s.type) ?? undefined,
                url: s.url as string,
              }))
          : []),
        ...extraSources,
      ],
    };
    // Cache SUCCESSES only. A pass that retrieved nothing is a transient
    // failure (search budget, a slow page, the 40s abort), not a fact about
    // the card — caching it meant "rerun this from scratch" replayed the same
    // empty answer for the next 3 hours instead of actually retrying.
    if (value.pointUsd != null && value.reliability !== 'unverified') {
      this.cache.set(cacheKey, { at: Date.now(), value });
    } else {
      this.cache.delete(cacheKey);
      this.logger.warn(
        `value_card "${clean}" returned ${value.reliability} (${out.pricingComps.length} comps) — not cached, next ask will retry`,
      );
    }
    // Where the seconds went. A pricing turn is the slowest thing the chat
    // does, so make the split diagnosable instead of a guess.
    // Include the comp count and newest date: "is it finding recent sales?"
    // is the question that actually matters, and it should be answerable from
    // one log line instead of a screenshot.
    const newest = compsUsed
      .map((c) => c.date)
      .filter((d): d is string => !!d)
      .sort()
      .pop();
    this.logger.log(
      `value_card "${clean}" ${Date.now() - t0}ms total — ` +
        Object.entries(marks)
          .map(([k, ms]) => `${k} ${ms}ms`)
          .join(', ') +
        ` · ${compsUsed.length} comps, newest ${newest ?? 'none'}`,
    );
    // Log the point-in-time valuation (data moat / price history) — best-effort.
    void this.persist(cacheKey, value);
    return value;
  }

  /** Append a valuation snapshot for the card's price history. */
  private async persist(subjectKey: string, v: CardValuation): Promise<void> {
    if (v.pointUsd == null) return; // nothing to chart
    try {
      await this.snapshots.save(
        this.snapshots.create({
          subjectKey: subjectKey.slice(0, 300),
          subject: v.subject.slice(0, 300),
          pointUsd: v.pointUsd,
          lowUsd: v.lowUsd,
          highUsd: v.highUsd,
          confidencePct: v.confidencePct,
          method: v.method,
          reliability: v.reliability,
          valuation: v as unknown as Record<string, unknown>,
        }),
      );
    } catch (e) {
      this.logger.warn(`valuation snapshot save failed: ${(e as Error).message}`);
    }
  }

  /** Price history for a card (our own logged valuations), oldest→newest. */
  async history(
    subject: string,
    limit = 60,
  ): Promise<ValuationHistoryPoint[]> {
    const key = (subject ?? '').trim().toLowerCase().slice(0, 300);
    if (!key) return [];
    try {
      const rows = await this.snapshots.find({
        where: { subjectKey: key },
        order: { createdAt: 'DESC' },
        take: Math.min(Math.max(limit, 1), 365),
      });
      return rows
        .reverse()
        .map(r => ({
          at: r.createdAt.toISOString(),
          pointUsd: r.pointUsd,
          lowUsd: r.lowUsd,
          highUsd: r.highUsd,
          confidencePct: r.confidencePct,
        }));
    } catch (e) {
      this.logger.warn(`valuation history failed: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * Pre-warm the valuation cache (before a live demo) so these cards return
   * instantly. Defaults to the showcase set; bounded concurrency.
   */
  async warm(
    subjects?: string[],
    adminId?: string,
  ): Promise<{ subject: string; pointUsd: number | null; confidencePct: number }[]> {
    const list = (
      subjects && subjects.length ? subjects : ValuationService.SHOWCASE_SUBJECTS
    ).slice(0, 20);
    const out: { subject: string; pointUsd: number | null; confidencePct: number }[] = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const slice = list.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        slice.map(s => this.valueCard(s, adminId).catch(() => null)),
      );
      results.forEach((v, k) =>
        out.push({
          subject: slice[k],
          pointUsd: v ? v.pointUsd : null,
          confidencePct: v ? v.confidencePct : 0,
        }),
      );
    }
    return out;
  }

  /** Evidence-tied trust label (the honesty gate). */
  private reliability(
    point: number | null,
    confPct: number,
    nPricingComps: number,
  ): Reliability {
    if (point == null) return 'unverified';
    if (nPricingComps >= 2 && confPct >= 70) return 'grounded';
    if (nPricingComps >= 1 || confPct >= 70) return 'thin';
    return 'unverified';
  }

  private money(n: number): string {
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }

  /**
   * Adversarial verifier: a cheap second pass that drops comps that don't hold
   * up as real, same-card confirmed sales — a fabricated/phantom price, a wrong
   * card or grade, a non-sales URL, or a wild outlier with no support. Defaults
   * to KEEP (only drops with a clear reason) and fails open, so it trims trust
   * killers without gutting thin evidence.
   */
  private async verifyComps(
    subject: string,
    comps: ValComp[],
    adminId?: string,
  ): Promise<ValComp[]> {
    if (comps.length === 0) return comps;
    // Skip the round trip only when there is genuinely nothing to adjudicate:
    // the outlier check needs two prices to compare, and the identity check
    // needs a title. The deterministic gates (real url, sale-typed source) are
    // already enforced by isPricingComp, so nothing is lost here.
    //
    // NOTE: a SINGLE comp that has a title is still verified. Thin, low-pop
    // cards are exactly where a wrong parallel does the most damage — that was
    // the $11k anchor complaint — so "one comp" alone is not a safe skip.
    if (comps.length < 2 && !comps.some((c) => c.title)) return comps;
    try {
      const list = comps
        .map(
          (c, i) =>
            `${i}: $${c.priceUsd} | ${c.date ?? 'no date'} | title: ${
              c.title ?? 'NO TITLE'
            } | ${c.grade ?? '?'} | ${c.sourceType} | ${c.url ?? 'NO URL'}`,
        )
        .join('\n');
      const res = await this.ai.generateJson<{ drop: number[] }>({
        // Haiku, not the chat model: this is a bounded field-by-field string
        // comparison against explicit rules, not open reasoning, and it sits
        // directly in the interactive path — the frontier model was costing
        // several seconds per pricing answer for no measurable accuracy gain.
        // If wrong-parallel comps start slipping through, this is the first
        // knob to turn back.
        model: 'claude-haiku-4-5',
        maxTokens: 600,
        system:
          'You are a strict comp verifier for card valuations. You are given a card and a numbered list of comps. Return the indices to DROP because a comp is NOT a trustworthy, same-card confirmed SALE. ' +
          'CHECK THE TITLE FIRST — it is the only field that identifies WHICH card sold. Compare each comp\'s title against the subject card field by field: player/character, year, set/product, insert or parallel name, card number, and grade. DROP any comp whose title names a different insert/parallel/variant, a different set or year, a different player, or a different grade — even when the price looks reasonable and even when it shares a url with the other comps. Several comps sharing one url does NOT make them the same card: a PSA sales-history page can list multiple parallels, so judge each title on its own. A comp with NO TITLE cannot be identity-checked, but KEEP it anyway — a missing title means our extraction failed, not that the sale is wrong, and dropping untitled rows quietly deletes real high sales. Drop an untitled comp only if its URL is not a plausible sale source. ' +
          'Also drop a comp that: has no real sales URL, has a URL/domain that is not a plausible sale/marketplace source, or is an active listing/ask passed off as a sale. ' +
          'PRICE IS NEVER A REASON TO DROP — NOT EVEN AN EXTREME ONE. Card prices spike. A sale far above the rest is usually the single most important comp (a record, a run, a grade-scarcity result), and deleting it silently understates the card. Never drop a comp for being high, low, or far from the others, however wide the gap. A wide spread is handled downstream by lowering confidence, not by discarding evidence. Identity is your ONLY test: does the title describe this exact card? ' +
          'Price agreement is NOT evidence of card identity — never keep a title-mismatched comp because it fits the price cluster. Otherwise be conservative: when the title genuinely matches and you are merely unsure, KEEP. Output JSON only.',
        prompt: `Card: ${subject}\n\nComps (index: price | date | grade | type | url):\n${list}\n\nReturn {"drop": [<indices to drop>]}.`,
        schema: {
          type: 'object',
          properties: {
            drop: { type: 'array', items: { type: 'integer' } },
          },
          required: ['drop'],
          additionalProperties: false,
        },
        meta: { feature: 'value_card_verify', adminId },
      });
      const drop = new Set(
        Array.isArray(res.drop) ? res.drop.filter(n => Number.isInteger(n)) : [],
      );
      if (drop.size === 0) return comps;
      const kept = comps.filter((_, i) => !drop.has(i));
      // Guard: never let the verifier nuke the entire evidence set.
      return kept.length > 0 ? kept : comps;
    } catch (e) {
      this.logger.warn(`comp verify failed: ${(e as Error).message}`);
      return comps; // fail open
    }
  }

  private num(v: unknown): number | null {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  private str(v: unknown): string | null {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, 200) : null;
  }

  private cleanComp(raw: Partial<ValComp>): ValComp | null {
    const price = this.num(raw.priceUsd);
    if (price == null) return null;
    return {
      priceUsd: price,
      date: typeof raw.date === 'string' ? raw.date.slice(0, 10) : null,
      title: this.str(raw.title),
      grade: this.str(raw.grade),
      sourceType: (this.str(raw.sourceType) ?? 'marketplace-listing').toLowerCase(),
      url: typeof raw.url === 'string' ? raw.url : null,
    };
  }

  /**
   * Sanitize the analogs backing a triangulated estimate. Anything without a
   * real price, a usable multiplier or a source url is dropped by
   * `isUsableAnalog` downstream — this just coerces shapes and caps sizes.
   */
  private cleanAnalogs(raw: unknown): ValAnalog[] {
    if (!Array.isArray(raw)) return [];
    const out: ValAnalog[] = [];
    for (const r of raw.slice(0, 8)) {
      const a = (r ?? {}) as Partial<ValAnalog>;
      const price = this.num(a.priceUsd);
      const mult = this.num(a.multiplier);
      if (price == null || mult == null) continue;
      out.push({
        title: this.str(a.title) ?? 'comparable card',
        priceUsd: price,
        date: typeof a.date === 'string' ? a.date.slice(0, 10) : null,
        relation: (
          this.str(a.relation) ?? 'same-set-comparable-tier'
        ).toLowerCase(),
        multiplier: mult,
        rationale: this.str(a.rationale),
        url: typeof a.url === 'string' ? a.url : null,
      });
    }
    return out;
  }

  private cleanComps(raw: unknown): ValComp[] {
    if (!Array.isArray(raw)) return [];
    const out: ValComp[] = [];
    for (const c of raw.slice(0, 12)) {
      const comp = this.cleanComp((c ?? {}) as Partial<ValComp>);
      // Dedupe: reading a page AND its search result commonly returns the same
      // sale twice, which would inflate the comp count and with it confidence.
      if (comp && !out.some(k => isSameComp(k, comp))) out.push(comp);
    }
    return out;
  }
}
