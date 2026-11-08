import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuctionCategory } from '../../prize/enums/auction-category.enum';

export const PUBLIC_BUCKETS = ['live', 'upcoming', 'ended'] as const;
export type PublicBucket = (typeof PUBLIC_BUCKETS)[number];

export const AUCTION_SORTS = [
  'ending',
  'newest',
  'price_asc',
  'price_desc',
  'bids',
] as const;
export type AuctionSort = (typeof AUCTION_SORTS)[number];

/** Public browse / search for the buyer marketplace. */
export class ListAuctionsQueryDto {
  @ApiPropertyOptional({ enum: PUBLIC_BUCKETS, default: 'live' })
  @IsOptional()
  @IsIn(PUBLIC_BUCKETS)
  bucket?: PublicBucket;

  @ApiPropertyOptional({ enum: AuctionCategory })
  @IsOptional()
  @IsEnum(AuctionCategory)
  category?: AuctionCategory;

  /** Words to match in the title, description or seller (all must match). */
  @ApiPropertyOptional({ example: 'jordan rookie psa' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /** `ending` = soonest first (live), soonest to open (upcoming), latest (ended). */
  @ApiPropertyOptional({ enum: AUCTION_SORTS, default: 'ending' })
  @IsOptional()
  @IsIn(AUCTION_SORTS)
  sort?: AuctionSort;

  /** On the current bid (or starting bid; the winning bid once ended). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  /** Only lots that take this rail (`both` lots match either). */
  @ApiPropertyOptional({ enum: ['fiat', 'crypto'] })
  @IsOptional()
  @IsIn(['fiat', 'crypto'])
  payment?: 'fiat' | 'crypto';

  @ApiPropertyOptional({ default: 48, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;
}
