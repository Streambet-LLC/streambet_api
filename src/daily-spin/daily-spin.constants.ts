/**
 * Daily spin reward configuration
 */

export interface SpinReward {
  coins: number;
  probability: number; // Percentage (0-100)
  min: number; // Minimum random value (inclusive)
  max: number; // Maximum random value (exclusive)
}

/**
 * Random seed (0-1) is mapped to ranges to determine reward
 */
export const SPIN_REWARDS: readonly SpinReward[] = [
  { coins: 1, probability: 50, min: 0, max: 0.5 },
  { coins: 2, probability: 30, min: 0.5, max: 0.8 },
  { coins: 5, probability: 15, min: 0.8, max: 0.95 },
  { coins: 10, probability: 5, min: 0.95, max: 1.0 },
];

/**
 * All users' spins reset at midnight UTC (00:00:00 UTC)
 */
export const DAILY_RESET_HOUR_UTC = 0;
export const DAILY_RESET_MINUTE_UTC = 0;
