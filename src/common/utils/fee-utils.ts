/**
 * Legacy single-rate buyer fee. Kept for any callers that haven't been
 * updated to the Card/ACH split. New code should use
 * {@link BUYER_CARD_FEE_PERCENT} / {@link BUYER_ACH_FEE_PERCENT} via
 * {@link getBuyerFeePercentForStripeMethod}.
 */
export const BUYER_PROCESSING_FEE_PERCENT = 3;

/**
 * Buyer service fee tiers, split by Stripe payment method. Card pays a
 * higher rate because Stripe's interchange + scheme fees are ~2.9% +
 * $0.30; ACH (us_bank_account) is a flat 0.8% capped at $5 on Stripe's
 * side. We charge the buyer slightly above cost so the fee covers
 * Stripe's processing on the item subtotal only (shipping is excluded
 * via {@link calculateBuyerItemFeeCents}).
 *
 * Values are PERCENT (not basis points) so they read naturally in code.
 */
export const BUYER_CARD_FEE_PERCENT = 3;
export const BUYER_ACH_FEE_PERCENT = 0.8;

/**
 * Allowed Stripe Checkout payment_method_types we offer to buyers for
 * non-coin-pack flows. Storing the raw Stripe identifier keeps the
 * mapping into `payment_method_types` trivial server-side.
 */
export type StripePaymentMethod = 'card' | 'us_bank_account';

/**
 * Resolve the buyer fee percentage for a chosen Stripe payment method.
 * Falls back to the card rate when the caller passes `null`/`undefined`
 * so legacy rows (created before the column existed) charge the safer
 * higher rate rather than under-billing.
 */
export function getBuyerFeePercentForStripeMethod(
  method?: StripePaymentMethod | null,
): number {
  if (method === 'us_bank_account') return BUYER_ACH_FEE_PERCENT;
  return BUYER_CARD_FEE_PERCENT;
}

export const SELLER_FEE_DEFAULT_PERCENT = 2;
export const SELLER_FEE_MIN_PERCENT = 2;
export const SELLER_FEE_MAX_PERCENT = 2;

export const MILESTONE_STEP_CADECOINS = 25000;
export const MILESTONE_FEE_REDUCTION_PERCENT = 0.5;
export const MILESTONE_MAX_LEVELS = 4;

export const CADECOINS_PER_USD = 50;
export const REWARD_COINS_PER_100_USD = 3;

function clampFeePercent(percent: number): number {
  return Math.max(
    SELLER_FEE_MIN_PERCENT,
    Math.min(SELLER_FEE_MAX_PERCENT, percent),
  );
}

export function getSellerMilestoneLevel(lifetimeCadeCoins: number): number {
  if (!Number.isFinite(lifetimeCadeCoins) || lifetimeCadeCoins <= 0) {
    return 0;
  }

  const computedLevel = Math.floor(
    lifetimeCadeCoins / MILESTONE_STEP_CADECOINS,
  );
  return Math.min(MILESTONE_MAX_LEVELS, computedLevel);
}

export function getSellerMilestoneFeePercent(
  lifetimeCadeCoins: number,
): number {
  const level = getSellerMilestoneLevel(lifetimeCadeCoins);
  const feePercent =
    SELLER_FEE_DEFAULT_PERCENT - level * MILESTONE_FEE_REDUCTION_PERCENT;
  return clampFeePercent(feePercent);
}

export function getEffectiveSellerFeePercent(params: {
  lifetimeCadeCoins: number;
  adminFeeOverridePercent?: number | null;
}): number {
  const { adminFeeOverridePercent } = params;

  if (
    adminFeeOverridePercent !== null &&
    adminFeeOverridePercent !== undefined
  ) {
    return clampFeePercent(adminFeeOverridePercent);
  }

  // Flat 2% fee for all sellers (milestone system disabled)
  return SELLER_FEE_DEFAULT_PERCENT;
}

export function calculateBuyerProcessingFeeCents(
  subtotalCents: number,
  buyerProcessingFeePercent = BUYER_PROCESSING_FEE_PERCENT,
): number {
  return Math.round(subtotalCents * (buyerProcessingFeePercent / 100));
}

export function calculateBuyerItemFeeCents(
  transactionSubtotalCents: number,
  shippingCents: number,
  buyerProcessingFeePercent = BUYER_PROCESSING_FEE_PERCENT,
): number {
  const itemSubtotalCents = Math.max(
    0,
    transactionSubtotalCents - shippingCents,
  );
  return Math.round(itemSubtotalCents * (buyerProcessingFeePercent / 100));
}

export function calculateSellerFeeCents(
  subtotalCents: number,
  sellerFeePercent: number,
): number {
  return Math.round(subtotalCents * (sellerFeePercent / 100));
}

export function calculateRewardCadeCoinsFromCents(
  totalTransactionCents: number,
): number {
  // 3 CadeCoins per $100, rounded to whole number of coins.
  return Math.round((totalTransactionCents * REWARD_COINS_PER_100_USD) / 10000);
}

export function convertUsdCentsToCadeCoins(totalUsdCents: number): number {
  return Math.round((totalUsdCents / 100) * CADECOINS_PER_USD);
}
