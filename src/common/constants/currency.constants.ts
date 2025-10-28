/**
 * Fixed conversion rate between sweep coins and USD.
 * Example: 20 sweep coins = 1 USD.
 */
export const SWEEP_COINS_PER_DOLLAR = 1;

/**
 * Minimum dollar amount allowed for withdrawal-related conversions.
 * This value is used to compute the minimum sweep coins required.
 */

export const MIN_WITHDRAWABLE_SWEEP_COINS = 1;

/**
 * The maximum allowed amount a user can place for a single bet with sweep coins.
 * This is used as an upper limit to prevent oversized wagers.
 */
export const MAX_AMOUNT_FOR_BETTING = 100;

/**
 * The maximum allowed amount a user can place for a single bet with gold coins.
 */
export const MAX_GOLD_COINS_FOR_BETTING = 1000;
