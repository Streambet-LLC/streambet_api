/**
 * Fixed conversion rate between sweep coins and USD.
 * Example: 20 sweep coins = 1 USD.
 */
export const SWEEP_COINS_PER_DOLLAR = 20;

/**
 * Minimum dollar amount allowed for withdrawal-related conversions.
 * This value is used to compute the minimum sweep coins required.
 */

export const MIN_WITHDRAWABLE_SWEEP_COINS = 20;

/**
 * The maximum allowed amount a user can place for a single bet.
 * This is used as an upper limit to prevent oversized wagers.
 */
export const MAX_AMOUNT_FOR_BETTING = 10000000;
