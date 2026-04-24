import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * Place a bid on an auction. The bidder commits a `proxyMaxUsd` (their
 * willing-to-pay max). The service runs the proxy engine and inserts:
 *  - a primary bid row at the necessary visible amount
 *  - if the previous leader's saved proxy outranks them, an auto bid row
 *    on behalf of the previous leader to counter them up to that proxy.
 *
 * The bidder must have a saved Stripe PaymentMethod attached to their
 * customer (from the prior SetupIntent). That id is snapshot on the bid
 * row so we can later run an off-session charge against it at close.
 */
export class PlaceBidDto {
  @ApiProperty({
    example: 75,
    description:
      'Maximum the bidder is willing to pay (USD, 2dp). Must be >= the current minimum next bid for this auction.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  proxyMaxUsd: number;

  @ApiProperty({
    description:
      'Stripe PaymentMethod id (pm_...) confirmed by the SetupIntent. Required on the very first bid; subsequent bids may reuse the saved one.',
    required: false,
  })
  @IsOptional()
  @IsString()
  stripePaymentMethodId?: string;

  /**
   * Shipping snapshot is optional in the bid payload — the user already
   * has a default address on their profile. The frontend lets them edit
   * it inline, and the edit goes through the existing `/users/me/address`
   * endpoint before the bid is submitted. We do NOT persist a per-bid
   * shipping snapshot — only the address-at-close is what matters for
   * fulfillment. This field is reserved for a future per-bid override.
   */
}
