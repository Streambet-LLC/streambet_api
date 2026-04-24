/**
 * How an item is sold. `fixed_price` is the existing buy / make-offer flow.
 * `auction` is bid-based with a fixed end time and Stripe autopay-on-win.
 *
 * Stored on `prize_configurations.sale_type`. Defaults to `fixed_price` so
 * all existing rows keep their current behavior.
 */
export enum PrizeSaleType {
  FIXED_PRICE = 'fixed_price',
  AUCTION = 'auction',
}
