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
export const CHAT_DEPTH: Record<AnswerDepth, ChatDepthPreset> = {
  quick: {
    effort: 'low',
    maxTokens: 900,
    maxSearches: 2,
    maxTurns: 6,
    style:
      'ANSWER STYLE — QUICK: Be very concise. One or two sentences, or up to 3 short bullets. Lead with the number/verdict; skip nuance and extra caveats.',
  },
  balanced: {
    effort: 'medium',
    maxTokens: 1600,
    maxSearches: 4,
    maxTurns: 8,
    style:
      'ANSWER STYLE — BALANCED: A tight, useful read — 2-4 sentences or up to ~6 bullets covering the key dimensions. This is the default brevity described above.',
  },
  deep: {
    effort: 'high',
    maxTokens: 3500,
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
