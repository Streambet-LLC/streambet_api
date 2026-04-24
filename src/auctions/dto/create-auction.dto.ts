import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsUUID,
  IsDateString,
  Min,
} from 'class-validator';

/**
 * Admin-only payload to create an auction for an existing prize item
 * (PrizeConfiguration). The item must have `saleType === 'auction'` and
 * must not already have an active auction (DB unique constraint enforces
 * this — the service still pre-validates for a friendlier error).
 */
export class CreateAuctionDto {
  @ApiProperty({
    description:
      'PrizeConfiguration id (the "item") this auction is for. The item must have saleType=auction.',
  })
  @IsUUID()
  prizeConfigurationId: string;

  @ApiProperty({ enum: [1, 3, 5, 7], description: 'Auction length in days.' })
  @IsIn([1, 3, 5, 7])
  durationDays: 1 | 3 | 5 | 7;

  @ApiProperty({
    example: 25,
    description: 'Starting price in USD. Must be >= 1.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  startingPriceUsd: number;

  @ApiProperty({
    example: 100,
    description:
      'Optional hidden reserve price in USD. If set, auction is only paid out when current bid >= reserve.',
    required: false,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  reservePriceUsd?: number;

  @ApiProperty({
    example: 75,
    description:
      'Internal card value (USD) recorded for analytics. Not surfaced to bidders.',
    required: false,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cardValueUsd?: number;

  @ApiProperty({
    example: '2026-04-25T12:00:00Z',
    description:
      'Optional scheduled start. If omitted, the auction starts immediately on create.',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string;
}
