/**
 * Answer depth ("data intensity & length") — a single user-facing knob that
 * scales how hard Cardy thinks, how much live data it pulls, and how long the
 * answer runs. Wired into both the Insights chat and the deep-dive research.
 */
export type AnswerDepth = 'quick' | 'balanced' | 'deep';

export interface ChatDepthPreset {
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
  /** web_search max_uses — the data-intensity dial. */
  maxSearches: number;
  maxTurns: number;
  /** Appended to the chat system prompt to shape length/detail. */
  style: string;
}

export interface DeepDiveDepthPreset {
  effort: 'low' | 'medium' | 'high' | 'xhigh';
  maxSearches: number;
  maxTokens: number;
}

/** Chat presets (interactive — latency matters, so kept tighter than dives). */
// NOTE: maxTokens is the WHOLE output budget (extended-thinking/effort tokens +
// the visible answer). Effort is on now, so these are generous to avoid the
// answer being truncated mid-sentence — the STYLE text keeps the *visible*
// reply appropriately short at lower depths.
export const CHAT_DEPTH: Record<AnswerDepth, ChatDepthPreset> = {
  quick: {
    effort: 'medium',
    maxTokens: 3000,
    maxSearches: 4,
    maxTurns: 7,
    style:
      'ANSWER STYLE — QUICK (brief pricing contract, follow exactly): Max ~5 short lines, no headers, no preamble. LINE 1: estimate + a confidence % + the anchor = the MOST RECENT confirmed sale ("~$X (N% confident). Anchor: last sale $Y on <date>"). LINE 2: the method in one clause (index-adjusted anchor / trimmed median of recent solds / triangulated — no direct comps). Then 1-3 COMPS you actually retrieved, one line each: $price — date — grade — source TYPE (auction-sale / private-sale / marketplace-listing / price-guide / index), price hyperlinked to the page you opened. LAST LINE: one sentence folding liquidity + trajectory + a sell/hold verdict. Do NOT run the buyers/rating/buzz dimension sweep — that is balanced/deep only. KEEP the confidence and source-types — those are required, not "nuance to skip". If asked about selling/timing, replace the last line with the 3-scenario block (P-up/base/down summing to 100 + expected value + verdict). Never cite a price without a retrieved link; never invent a sale; if you generated a sold-comps search link you MUST read and cite the comps in it.',
  },
  balanced: {
    effort: 'medium',
    maxTokens: 5000,
    maxSearches: 4,
    maxTurns: 8,
    style:
      'ANSWER STYLE — BALANCED: A tight, useful read — 2-4 sentences or up to ~6 bullets. Start with the brief valuation contract (anchor = most-recent sale + estimate/range + confidence % + the comps you retrieved), THEN add a compact read on the key dimensions — likely buyers, liquidity, price trajectory, overall take — one line each. Same grounding rules (no unretrieved prices, anchor most-recent, complete the circle). No filler.',
  },
  deep: {
    effort: 'high',
    maxTokens: 9000,
    maxSearches: 8,
    maxTurns: 10,
    style:
      'ANSWER STYLE — DEEP (override the brief-by-default rule): The user asked for a thorough answer. Expand with detail and context, work in MORE dimensions where relevant (pricing & recent comps, social buzz, catalysts with odds, precedents, macro/supply/grading, likely buyers, risks), and cite more sources. A longer, well-structured answer with short headers/bullets is expected — but still no filler, preamble, or repetition.',
  },
};

/** Deep-dive presets (background — can afford far more searches + tokens). */
export const DEEP_DIVE_DEPTH: Record<AnswerDepth, DeepDiveDepthPreset> = {
  quick: { effort: 'low', maxSearches: 5, maxTokens: 5000 },
  balanced: { effort: 'medium', maxSearches: 8, maxTokens: 8000 },
  deep: { effort: 'high', maxSearches: 16, maxTokens: 12000 },
};

/** Coerce arbitrary input to a valid depth (defaults to balanced). */
export function normalizeDepth(v: unknown): AnswerDepth {
  return v === 'quick' || v === 'deep' ? v : 'balanced';
}
