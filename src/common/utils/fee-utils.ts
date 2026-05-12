export const BUYER_PROCESSING_FEE_PERCENT = 3;
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
