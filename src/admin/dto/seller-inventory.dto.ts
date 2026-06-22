import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';

export const SELLER_INVENTORY_SOURCES = ['csv', 'excel', 'google_sheets'] as const;
export type SellerInventorySource = (typeof SELLER_INVENTORY_SOURCES)[number];

/** A single normalized inventory row sent from the client after mapping. */
export class IngestInventoryItemDto {
  @ApiProperty({ description: 'Product / card name.' })
  @IsString()
  @MaxLength(1000)
  productName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  setName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  condition?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  grade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  priceUsd?: number;

  @ApiPropertyOptional({ description: 'Original row, preserved verbatim.' })
  @IsOptional()
  @IsObject()
  raw?: Record<string, unknown>;
}

/** Payload for POST /admin/analytics/sellers/inventory. */
export class IngestSellerInventoryDto {
  @ApiPropertyOptional({ description: 'Linked CardCade seller user id.' })
  @IsOptional()
  @IsString()
  sellerUserId?: string;

  @ApiPropertyOptional({ description: 'Free-text seller name when off-platform.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sellerLabel?: string;

  @ApiProperty({ enum: SELLER_INVENTORY_SOURCES })
  @IsIn(SELLER_INVENTORY_SOURCES)
  source: SellerInventorySource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  fileName?: string;

  @ApiProperty({ type: [IngestInventoryItemDto] })
  @IsArray()
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => IngestInventoryItemDto)
  items: IngestInventoryItemDto[];
}
