/**
 * Configuration for promoted betting rounds display limits.
 * 
 * These limits apply to PUBLIC-FACING endpoints only.
 * Admin endpoints do NOT use these limits (admins need full visibility).
 * 
 * Each context defines:
 * - totalLimit: Maximum number of rounds to return
 * - maxPromotedRounds: Maximum rounds per individual promoted stream
 * - fetchBufferMultiplier: How many extra rounds to fetch for filtering
 * 
 * Example: homepage fetches 50 rounds (10 * 5), filters to 2 per promoted stream,
 *          returns final 10 rounds.
 */
export const PromotedBetsConfig = {
  /**
   * Homepage "Featured Streams" carousel
   * Conservative limits for focused, curated user experience
   */
  homepage: {
    totalLimit: 10,
    maxPromotedRounds: 2,
    fetchBufferMultiplier: 5,
  },
  
  /**
   * "Live Bets" section - currently active betting
   * Higher limits to show more variety and options
   */
  displayBets: {
    totalLimit: 20,
    maxPromotedRounds: 3,
    fetchBufferMultiplier: 4,
  },
  
  /**
   * "Upcoming Bets" section - scheduled future bets
   * Moderate limits to preview what's coming without overwhelming
   */
  upcomingBets: {
    totalLimit: 15,
    maxPromotedRounds: 2,
    fetchBufferMultiplier: 4,
  },
} as const;

export type PromotedBetsContext = keyof typeof PromotedBetsConfig;

/**
 * Get configuration for a specific context
 * 
 * @param context - The context requesting promoted bets configuration
 * @returns Configuration object with limits and buffer settings
 */
export function getPromotedBetsConfig(context: PromotedBetsContext) {
  return PromotedBetsConfig[context];
}
