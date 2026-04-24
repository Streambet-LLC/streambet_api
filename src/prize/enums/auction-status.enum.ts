/**
 * Lifecycle status of an auction.
 *
 * - `scheduled`  — created but its `starts_at` is in the future.
 * - `active`     — bidding is open (now between `starts_at` and `ends_at`).
 * - `ended`      — `ends_at` has passed; we are determining the winner /
 *                  charging their saved card.
 * - `paid`       — winner's autopay succeeded; a fulfilled PrizeOrder exists.
 * - `unsold`     — closed with no qualifying bid (no bids, or reserve not met
 *                  with no fallback bidder).
 * - `failed`     — autopay declined for the winner AND every runner-up we
 *                  attempted within the grace period. Manual intervention
 *                  required.
 * - `cancelled`  — admin cancelled before close.
 */
export enum AuctionStatus {
  SCHEDULED = 'scheduled',
  ACTIVE = 'active',
  ENDED = 'ended',
  PAID = 'paid',
  UNSOLD = 'unsold',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}
