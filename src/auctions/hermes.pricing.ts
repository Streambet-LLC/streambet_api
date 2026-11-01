import type { AuctionFundingMethod } from './hermes.types';

/**
 * Hermes Auctions pricing. Zero-fee: there is no buyer premium and no
 * seller fee. The winner pays hammer + flat shipping; card payers also
 * cover card processing (grossed up so Stripe's 2.9% + 30¢ nets to zero).
 * ACH and USDC carry no processing charge.
 */
export const CARD_PROCESSING_PERCENT = 2.9;
export const CARD_PROCESSING_FIXED_USD = 0.3;

/** Bids inside this many seconds of the end push the end out to now + window. */
export const ANTI_SNIPE_WINDOW_SECONDS = 60;

/** Grace period for a winner whose charge needs action or declined. */
export const PAYMENT_GRACE_HOURS = 48;

/** USDC escrow self-withdraw unlocks this long after the scheduled end. */
export const ESCROW_REFUND_AFTER_DAYS = 7;

const INCREMENT_LADDER: Array<[upTo: number, step: number]> = [
  [25, 1],
  [100, 5],
  [250, 10],
  [500, 25],
  [1_000, 50],
  [2_500, 100],
  [5_000, 250],
  [10_000, 500],
  [25_000, 1_000],
  [50_000, 2_500],
];

/** Minimum raise over `currentUsd`, roughly 5–10% at every price tier. */
export function minIncrementFor(currentUsd: number): number {
  for (const [upTo, step] of INCREMENT_LADDER) {
    if (currentUsd < upTo) return step;
  }
  return 5_000;
}

export function minNextBid(
  currentUsd: number | null,
  startingUsd: number,
): number {
  if (currentUsd === null) return startingUsd;
  return round2(currentUsd + minIncrementFor(currentUsd));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function cardFeeFor(subtotalUsd: number): number {
  if (subtotalUsd <= 0) return 0;
  const gross =
    (subtotalUsd + CARD_PROCESSING_FIXED_USD) /
    (1 - CARD_PROCESSING_PERCENT / 100);
  return round2(Math.ceil(gross * 100) / 100 - subtotalUsd);
}

export interface WinTotals {
  hammerUsd: number;
  shippingUsd: number;
  cardFeeUsd: number;
  totalUsd: number;
}

export function winTotals(
  hammerUsd: number,
  shippingUsd: number,
  method: AuctionFundingMethod,
): WinTotals {
  const hammer = round2(Math.max(0, hammerUsd));
  const shipping = round2(Math.max(0, shippingUsd));
  const cardFee = method === 'card' ? cardFeeFor(hammer + shipping) : 0;
  return {
    hammerUsd: hammer,
    shippingUsd: shipping,
    cardFeeUsd: cardFee,
    totalUsd: round2(hammer + shipping + cardFee),
  };
}

/** USDC base units (6 decimals) ↔ USD. USDC is treated as 1:1 with USD. */
export function usdToUsdcUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 100)) * 10_000n;
}

export function usdcUnitsToUsd(units: bigint): number {
  // Floor to the cent: never credit a bidder with more than they escrowed.
  return Number(units / 10_000n) / 100;
}
