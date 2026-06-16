/**
 * Rough "buyer volume" guesstimate (High / Medium / Low) for the admin
 * Analytics surface — a quick read on how big a buyer a collector is. v1 keys
 * purely off lifetime paid spend; the thresholds are the single tuning knob.
 * Returns null for non-buyers ($0) so the column shows "—".
 */
export const BUYER_VOLUME_HIGH_USD = 2000;
export const BUYER_VOLUME_MEDIUM_USD = 500;

export type BuyerVolume = 'High' | 'Medium' | 'Low';

export function deriveBuyerVolume(
  lifetimeSpendUsd: number,
): BuyerVolume | null {
  if (!Number.isFinite(lifetimeSpendUsd) || lifetimeSpendUsd <= 0) return null;
  if (lifetimeSpendUsd >= BUYER_VOLUME_HIGH_USD) return 'High';
  if (lifetimeSpendUsd >= BUYER_VOLUME_MEDIUM_USD) return 'Medium';
  return 'Low';
}
