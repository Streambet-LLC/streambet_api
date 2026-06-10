/**
 * Canonical server-side Mixpanel event names. Keep these in sync with the
 * web client's catalog (streambet_web/src/lib/mixpanel.ts). Server events are
 * the money/outcome truth (purchases, settlements, wins, accepted offers);
 * the client tracks intent/funnel (started checkout, placed bid, made offer).
 */
export const AnalyticsEvent = {
  // Auth
  USER_SIGNED_UP: 'User Signed Up',

  // Checkout / payments (server truth)
  PURCHASE_COMPLETED: 'Purchase Completed',
  ACH_PAYMENT_SETTLED: 'ACH Payment Settled',
  ACH_PAYMENT_FAILED: 'ACH Payment Failed',

  // Auctions (server truth)
  AUCTION_WON: 'Auction Won',

  // Offers / bundles (server truth)
  OFFER_ACCEPTED: 'Offer Accepted',
  OFFER_COUNTERED: 'Offer Countered',
  OFFER_REJECTED: 'Offer Rejected',
  BUNDLE_OFFER_ACCEPTED: 'Bundle Offer Accepted',
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];
