import type { AuctionFundingMethod } from './hermes.types';

/**
 * Hermes Auctions pricing. Zero seller fee. The winner pays hammer + a
 * buyer fee ("premium") on the hammer + flat shipping. The fee rate depends
 * on how they pay (see BUYER_PREMIUM_RATES) and is all-in: payment processing
 * (Stripe's card / ACH fees) comes out of it, nothing is added on top.
 */

export type PremiumRates = Record<AuctionFundingMethod, number>;

/**
 * Buyer fee for newly created auctions, as a percent of the hammer, by the
 * tender the winner pays with (2026-11-09: card 4%, ACH 1%, USDC 1%;
 * USDC was 0.5% earlier that day).
 * Each auction stores its own three rates at creation, so changing these
 * never changes the terms of an auction already listed.
 */
export const BUYER_PREMIUM_RATES: Readonly<PremiumRates> = Object.freeze({
  card: 4,
  ach: 1,
  usdc: 1,
});

/**
 * Soft close: a bid inside this many seconds of the end resets the clock to
 * now + window (no cap). Sent to bidders as `extensionWindowSeconds`.
 */
export const ANTI_SNIPE_WINDOW_SECONDS = 120;

/** "2 minutes", "1 minute", "30 seconds" — for bidder-facing copy. */
export function fmtExtensionWindow(
  seconds = ANTI_SNIPE_WINDOW_SECONDS,
): string {
  if (seconds % 60 === 0) {
    const m = seconds / 60;
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}

/** Grace period for a winner whose charge needs action or declined. */
export const PAYMENT_GRACE_HOURS = 48;

/** The unpaid winner gets a reminder email this long before the grace window ends. */
export const PAYMENT_REMINDER_HOURS_BEFORE_DUE = 12;

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

/** Premium on the hammer, rounded half-up to the cent (integer-cent math). */
export function buyerPremiumFor(hammerUsd: number, percent: number): number {
  if (hammerUsd <= 0 || !(percent > 0)) return 0;
  const hammerCents = Math.round(hammerUsd * 100);
  return Math.round((hammerCents * percent) / 100) / 100;
}

/**
 * What a USDC bidder's escrow must hold to back `maxUsd`: a win settles
 * hammer + premium + shipping from escrow, and the hammer can reach the max.
 */
export function usdcEscrowNeeded(
  maxUsd: number,
  shippingUsd: number,
  premiumPercent: number,
): number {
  return round2(maxUsd + buyerPremiumFor(maxUsd, premiumPercent) + shippingUsd);
}

export interface WinTotals {
  hammerUsd: number;
  buyerPremiumUsd: number;
  shippingUsd: number;
  totalUsd: number;
}

/** What the winner owes at `premiumPercent` (the rate for their tender). */
export function winTotals(
  hammerUsd: number,
  shippingUsd: number,
  premiumPercent: number,
): WinTotals {
  const hammer = round2(Math.max(0, hammerUsd));
  const premium = buyerPremiumFor(hammer, premiumPercent);
  const shipping = round2(Math.max(0, shippingUsd));
  return {
    hammerUsd: hammer,
    buyerPremiumUsd: premium,
    shippingUsd: shipping,
    totalUsd: round2(hammer + premium + shipping),
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
