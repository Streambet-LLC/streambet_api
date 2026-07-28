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
  /**
   * Appended to the research prompt to shape how much lands in each field of
   * the report. Without this, depth only changed how hard the model researched
   * — the JSON schema fixes the report's shape, so every depth produced the
   * same-sized brief and the setting looked broken.
   */
  style: string;
}

/** Chat presets (interactive — latency matters, so kept tighter than dives). */
// NOTE: maxTokens is the WHOLE output budget (extended-thinking/effort tokens +
// the visible answer). Effort is on now, so these are generous to avoid the
// answer being truncated mid-sentence — the STYLE text keeps the *visible*
// reply appropriately short at lower depths.
export const CHAT_DEPTH: Record<AnswerDepth, ChatDepthPreset> = {
  quick: {
    effort: 'low',
    maxTokens: 3000,
    maxSearches: 3,
    maxTurns: 7,
    style:
      'ANSWER STYLE — BRIEF. This block sets the length of your answer; it overrides any other sense of how long to be.\n' +
      'AFTER value_card ran: the visual card already shows price, range, confidence, method and comps — write ONE sentence only: the sell/hold verdict (add a second only if they asked something non-price, e.g. timing). Do not restate any number the card shows.\n' +
      'WITHOUT value_card: max ~5 short lines, no headers, no preamble. Lead with the direct answer, then at most 2 supporting lines, then a one-line take. If they asked about sell timing, use the 3-scenario block (P-up/base/down summing to 100 + expected value + verdict) instead of the take.\n' +
      'Skip the buyers/rating/buzz dimension sweep — that is balanced/deep only. Brevity NEVER justifies dropping a confidence %, a source type, or a link on a price you cite.',
  },
  balanced: {
    effort: 'medium',
    maxTokens: 5000,
    maxSearches: 5,
    maxTurns: 8,
    style:
      'ANSWER STYLE — BALANCED. This block sets the length of your answer; it overrides any other sense of how long to be.\n' +
      'AFTER value_card ran: the visual card already shows price, range, confidence, method and comps — do not restate those. Write 2-4 sentences (or up to 4 bullets): the sell/hold verdict, plus a compact read on liquidity, price trajectory, and likely buyers — one clause each.\n' +
      'WITHOUT value_card: 4-8 lines. Lead with the direct answer, support it with the comps or evidence you actually retrieved (price — date — grade — source type, price hyperlinked), then the same compact dimensional read.\n' +
      'No filler, no preamble, no repetition.',
  },
  deep: {
    effort: 'high',
    maxTokens: 9000,
    maxSearches: 8,
    maxTurns: 10,
    style:
      'ANSWER STYLE — DEEP. This block sets the length of your answer; it overrides any other sense of how long to be. The user explicitly asked for thorough, so a long, well-structured answer with short headers and bullets is CORRECT here — do not trim it back toward brevity.\n' +
      "AFTER value_card ran: still do not restate the price, range, confidence or comps — the card shows them. Everything else expands: open with the verdict, then work through the dimensions that matter with a short header each — liquidity, price trajectory, likely buyers, upcoming catalysts with rough odds, comparable precedents with what their prices did, supply/reprint/grading factors, and the main risks. Explain the MECHANISM in each: how it reaches this card's price and how big the move could be.\n" +
      'WITHOUT value_card: the same structure, with the retrieved evidence laid out first (price — date — grade — source type, each price hyperlinked).\n' +
      'Cite more sources than you would at lower depths. Substance, not padding — never repeat a point across sections to fill space.',
  },
};

/**
 * Deep-dive presets (background — can afford far more searches + tokens).
 * The `style` lines set explicit item counts per section, because "be brief"
 * and "be thorough" barely move a model that is filling a fixed JSON schema —
 * countable targets do.
 */
export const DEEP_DIVE_DEPTH: Record<AnswerDepth, DeepDiveDepthPreset> = {
  quick: {
    effort: 'low',
    maxSearches: 5,
    maxTokens: 5000,
    style:
      'REPORT DEPTH — BRIEF: keep every field tight and prioritise signal over coverage. Thesis: 1-2 sentences. At most 3 catalysts, 2 precedents, 2 macro factors, 2 risks — one short line of explanation each. Include only the strongest items; drop the marginal ones rather than padding the list. Never drop the grounded prices, dates, or source links to save room.',
  },
  balanced: {
    effort: 'medium',
    maxSearches: 8,
    maxTokens: 8000,
    style:
      'REPORT DEPTH — BALANCED: a useful working brief. Thesis: 2-3 sentences. Up to 5 catalysts, 3 precedents, 3 macro factors, 3 risks — one or two lines each, saying WHY it matters to the price, not just naming it.',
  },
  deep: {
    effort: 'high',
    maxSearches: 16,
    maxTokens: 12000,
    style:
      "REPORT DEPTH — DEEP: the thorough version the user explicitly asked for. Thesis: 3-5 sentences. Up to 8 catalysts, 5 precedents, 5 macro factors, 5 risks. For each, explain the MECHANISM — how it actually transmits to this card's price, how big the move could be, and what would confirm or kill it. Precedents should name the comparable card, the event, and what the price did, with numbers. Cite more sources. Substance, not padding: never repeat a point across sections to fill space.",
  },
};

/** Coerce arbitrary input to a valid depth (defaults to balanced). */
export function normalizeDepth(v: unknown): AnswerDepth {
  return v === 'quick' || v === 'deep' ? v : 'balanced';
}
