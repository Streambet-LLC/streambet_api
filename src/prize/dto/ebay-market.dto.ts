import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class EbayMarketWindowAverageDto {
  @ApiProperty({ example: '30d' })
  window: '7d' | '30d' | '90d' | '180d' | '365d' | 'all';

  @ApiProperty({ example: 154.22, nullable: true })
  averagePrice: number | null;

  @ApiProperty({ example: 27 })
  soldCount: number;
}

export class EbayMarketSummaryDto {
  @ApiProperty({ example: 'uuid' })
  itemId: string;

  @ApiProperty({ example: 199.99, nullable: true })
  listingPrice: number | null;

  @ApiProperty({ example: 178.45, nullable: true })
  averagePrice: number | null;

  @ApiProperty({ example: 10 })
  soldCountUsed: number;

  @ApiProperty({
    example: 12.07,
    nullable: true,
    description:
      'Percent difference versus market average. Positive means listing is above market, negative means below market.',
  })
  percentDifference: number | null;

  @ApiProperty({ example: '2026-05-01T14:00:00.000Z', nullable: true })
  lastCalculatedAt: Date | null;

  @ApiProperty({ example: '2026-05-01T14:05:00.000Z', nullable: true, description: 'Last time eBay sold data was successfully fetched' })
  lastFetchedAt: Date | null;

  @ApiProperty({ example: 83 })
  totalValidSoldCount: number;

  @ApiProperty({ example: 189.5, nullable: true, description: 'Sale price of the most recent sold listing' })
  mostRecentSalePrice: number | null;

  @ApiProperty({ example: '2026-04-29T09:25:00.000Z', nullable: true, description: 'Date of the most recent sold listing' })
  mostRecentSaleDate: Date | null;

  @ApiProperty({ type: [EbayMarketWindowAverageDto] })
  windows: EbayMarketWindowAverageDto[];
}

export class EbayMarketSoldListingDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: '305955606880', nullable: true })
  providerItemId: string | null;

  @ApiProperty({ example: 'Charizard EX PSA 10' })
  soldTitle: string;

  @ApiProperty({ example: 189.5 })
  salePrice: number;

  @ApiProperty({ example: '$', nullable: true })
  currencySymbol: string | null;

  @ApiProperty({ example: '2026-04-29T09:25:00.000Z', nullable: true })
  dateSold: Date | null;

  @ApiProperty({ example: 'https://i.ebayimg.com/images/g/abc/s-l1600.jpg', nullable: true })
  imageUrl: string | null;

  @ApiProperty({ example: 'https://www.ebay.com/itm/305955606880', nullable: true })
  listingUrl: string | null;

  @ApiProperty({ example: 'PSA 10', nullable: true })
  itemCondition: string | null;

  @ApiProperty({ example: 'Auction', nullable: true })
  buyingFormat: string | null;

  @ApiProperty({ example: 4.99, nullable: true })
  shippingPrice: number | null;
}

export class AdminEbayMarketSoldListingDto extends EbayMarketSoldListingDto {
  @ApiProperty({ example: 'Charizard EX PSA 10 Fossil', nullable: true })
  searchQuery: string | null;

  @ApiProperty({ example: false })
  isInaccurate: boolean;

  @ApiProperty({ example: 'Wrong card variant', nullable: true })
  inaccurateReason: string | null;

  @ApiProperty({ example: 'uuid', nullable: true })
  inaccurateFlaggedByUserId: string | null;

  @ApiProperty({ example: '2026-05-01T16:20:00.000Z', nullable: true })
  inaccurateFlaggedAt: Date | null;
}

export class AdminReportedEbaySoldListingDto extends AdminEbayMarketSoldListingDto {
  @ApiProperty({ example: 'uuid' })
  itemId: string;

  @ApiProperty({ example: 'Charizard EX PSA 10' })
  itemName: string;

  @ApiProperty({ example: 'https://cdn.example.com/item.jpg', nullable: true })
  itemImageUrl: string | null;

  @ApiProperty({ example: 'collector123', nullable: true })
  flaggedByUsername: string | null;

  @ApiProperty({ example: 'collector@example.com', nullable: true })
  flaggedByEmail: string | null;
}

export class ModerateEbaySoldListingDto {
  @ApiProperty({
    example: true,
    description: 'Set true to mark inaccurate, false to clear inaccurate status.',
  })
  @IsBoolean()
  isInaccurate: boolean;

  @ApiProperty({
    example: 'Wrong grade and not the same card version',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class UpdateItemEbaySearchQueryDto {
  @ApiProperty({
    example: 'Charizard EX PSA 10 Fossil',
    required: false,
    nullable: true,
    description: 'Search query used to fetch eBay sold listings. Null resets to using the item name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ebaySearchQuery: string | null;
}

export class BulkDeleteEbaySoldListingsDto {
  @ApiProperty({
    example: ['uuid-1', 'uuid-2'],
    description: 'Array of sold listing IDs to delete (1–200 at a time)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  listingIds: string[];
}

export class BulkModerateEbaySoldListingsDto {
  @ApiProperty({
    example: ['uuid-1', 'uuid-2'],
    description: 'Array of sold listing IDs to flag/unflag (1–200 at a time)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  listingIds: string[];

  @ApiProperty({
    example: true,
    description: 'Set true to mark inaccurate, false to clear inaccurate status.',
  })
  @IsBoolean()
  isInaccurate: boolean;

  @ApiProperty({
    example: 'Bulk flagged by admin',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ReportEbaySoldListingDto {
  @ApiProperty({
    example: 'This listing title does not match the card shown',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class BulkUpdateEbayVisibilityDto {
  @ApiProperty({
    example: ['uuid-1', 'uuid-2'],
    description: 'Array of prize configuration item IDs to update (1–200 at a time)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  itemIds: string[];

  @ApiProperty({
    example: true,
    description: 'Set true to show eBay avg publicly, false to hide it (admin only).',
  })
  @IsBoolean()
  showPublicly: boolean;
}

export class EbayMarketHistoryDto {
  @ApiProperty({ example: 'uuid' })
  itemId: string;

  @ApiProperty({ type: EbayMarketSummaryDto })
  summary: EbayMarketSummaryDto;

  @ApiProperty({ type: [EbayMarketSoldListingDto] })
  listings: EbayMarketSoldListingDto[];
}
