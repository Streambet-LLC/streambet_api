import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Min,
} from 'class-validator';
import type { AuctionFundingMethod } from '../hermes.types';

/**
 * Place a (proxy) bid. `proxyMaxUsd` is the bidder's willing-to-pay max;
 * the engine shows only the price needed to lead.
 *
 * Funding:
 *  - `card` / `ach`: a saved Stripe PaymentMethod of that type is charged
 *    off-session at close (`stripePaymentMethodId`, or the newest saved).
 *  - `usdc`: the bidder's on-chain escrow for this auction must already
 *    hold at least `proxyMaxUsd`.
 */
export class PlaceBidDto {
  @ApiProperty({ example: 75 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  proxyMaxUsd: number;

  @ApiProperty({ enum: ['card', 'ach', 'usdc'] })
  @IsIn(['card', 'ach', 'usdc'])
  fundingMethod: AuctionFundingMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^pm_[A-Za-z0-9]+$/)
  stripePaymentMethodId?: string;
}

export class PaymentSetupDto {
  @ApiProperty({ enum: ['card', 'ach'] })
  @IsIn(['card', 'ach'])
  method: 'card' | 'ach';

  @ApiProperty({ description: 'Where Stripe returns the bidder.' })
  @IsUrl({ require_tld: false })
  returnUrl: string;
}

export class RetryCheckoutDto {
  @ApiProperty({ enum: ['card', 'ach'] })
  @IsIn(['card', 'ach'])
  method: 'card' | 'ach';

  @ApiProperty()
  @IsUrl({ require_tld: false })
  returnUrl: string;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class CryptoDepositQuoteDto {
  @ApiProperty({ description: 'Bidder Solana wallet (base58).' })
  @Matches(BASE58)
  wallet: string;

  @ApiProperty({ description: 'USDC to add to the escrow (USD, 2dp).' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amountUsd: number;
}

export class CryptoDepositConfirmDto {
  @ApiProperty()
  @Matches(BASE58)
  wallet: string;

  @ApiProperty({ description: 'Signature of the deposit transaction.' })
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/)
  signature: string;
}
