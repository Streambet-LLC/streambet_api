/**
 * Signup attribution (Meta ads brief, 2026-11-12): the first-touch ad params
 * a visitor landed with, stored on `users.signup_attribution` at signup so we
 * can see e.g. "this signup came from the Tyranitar Meta ad".
 *
 * The web app captures these on the first tagged landing (localStorage) and
 * sends them with the signup. They are self-reported marketing data, so the
 * API keeps only the known keys, as trimmed strings, and never fails a signup
 * over them.
 */
export const SIGNUP_ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  /** Path of the first tagged landing, e.g. /auctions/<id>. */
  'landing_path',
  /** ISO time of that landing. */
  'captured_at',
] as const;

export type SignupAttributionKey = (typeof SIGNUP_ATTRIBUTION_KEYS)[number];
export type SignupAttribution = Partial<Record<SignupAttributionKey, string>>;

/** fbclid values run ~100–200 chars; anything far past that is junk. */
const MAX_VALUE_LENGTH = 500;

/** Known keys only, non-empty strings, capped length; null when nothing is left. */
export function sanitizeSignupAttribution(
  raw: unknown,
): SignupAttribution | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: SignupAttribution = {};
  for (const key of SIGNUP_ATTRIBUTION_KEYS) {
    const v = src[key];
    if (typeof v !== 'string') continue;
    const s = v.trim().slice(0, MAX_VALUE_LENGTH);
    if (s) out[key] = s;
  }
  return Object.keys(out).length ? out : null;
}
