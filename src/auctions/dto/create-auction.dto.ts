import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuctionCategory } from '../../prize/enums/auction-category.enum';
import type { AcceptedPayments, AuctionLengthPreset } from '../hermes.types';

export class AuctionImageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  url: string;
}

export class AuctionVideoDto {
  @ApiProperty({ enum: ['upload', 'youtube', 'vimeo'] })
  @IsIn(['upload', 'youtube', 'vimeo'])
  kind: 'upload' | 'youtube' | 'vimeo';

  @ApiProperty()
  @IsUrl({ require_tld: false })
  url: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  key?: string;
}

/**
 * Admin create payload for a Hermes auction. The end is either
 * `startsAt + lengthPreset days` or the explicit `endsAt` for `custom`.
 */
export class CreateAuctionDto {
  @ApiProperty({ example: '2018 Panini Prizm Luka Doncic Silver PSA 10' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty()
  @IsString()
  @MaxLength(10_000)
  description: string;

  @ApiProperty({ enum: AuctionCategory })
  @IsEnum(AuctionCategory)
  category: AuctionCategory;

  @ApiProperty({ type: [AuctionImageDto] })
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => AuctionImageDto)
  images: AuctionImageDto[];

  @ApiPropertyOptional({ type: [AuctionVideoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => AuctionVideoDto)
  videos?: AuctionVideoDto[];

  @ApiPropertyOptional({
    description: 'ISO start. Omit (or pass a past time) to start immediately.',
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiProperty({ enum: ['7', '14', '21', 'custom'] })
  @IsIn(['7', '14', '21', 'custom'])
  lengthPreset: AuctionLengthPreset;

  @ApiPropertyOptional({ description: 'Required when lengthPreset = custom.' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiProperty({ example: 50 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  startingPriceUsd: number;

  @ApiPropertyOptional({ description: 'Omit or null for no reserve.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  reservePriceUsd?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estValueUsd?: number | null;

  @ApiPropertyOptional({ enum: ['manual', 'pulled'] })
  @IsOptional()
  @IsIn(['manual', 'pulled'])
  estValueSource?: 'manual' | 'pulled' | null;

  @ApiPropertyOptional({
    description: 'Snapshot of the accepted recommendation.',
  })
  @IsOptional()
  @IsObject()
  estValueMeta?: Record<string, unknown> | null;

  @ApiProperty({ example: 15 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shippingUsd: number;

  @ApiPropertyOptional({ description: 'Pin to the landing-page feature rail.' })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({
    enum: ['fiat', 'crypto', 'both'],
    description:
      'fiat = card + bank (ACH), crypto = USDC escrow. Default both.',
  })
  @IsOptional()
  @IsIn(['fiat', 'crypto', 'both'])
  acceptedPayments?: AcceptedPayments;
}

/** Everything is optional on update; the service decides what's editable. */
export class UpdateAuctionDto extends PartialType(CreateAuctionDto) {}

export class EstimateValueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string;

  @ApiProperty({ enum: AuctionCategory })
  @IsEnum(AuctionCategory)
  category: AuctionCategory;

  @ApiPropertyOptional({
    description: 'Uploaded photo URLs (first 2 are read).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUrl({ require_tld: false }, { each: true })
  imageUrls?: string[];
}

export class MarkShippedDto {
  @ApiProperty({ example: 'USPS' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  carrier: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  trackingNumber: string;
}
