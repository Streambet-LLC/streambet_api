import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  Min,
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { PrizeCategory } from '../enums/prize-category.enum';
import { PrizePurchaseOption } from '../enums/prize-purchase-option.enum';

/**
 * DTO for individual prize tier information
 */
export class PrizeItemDto {
  @ApiProperty({
    example: 1,
    description: 'Prize tier number (1, 2, 3, etc.)',
  })
  @IsInt()
  @Min(1)
  prizeTier: number;

  @ApiProperty({
    example: 500,
    description: 'Prize amount threshold in lifetime coins',
  })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({
    example: 'Collector',
    description: 'Display name for the prize tier',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Reach 500 lifetime coins to unlock the Collector badge',
    description: 'Description of the prize',
  })
  @IsString()
  description: string;

  @ApiProperty({
    example: 'https://s3.amazonaws.com/...',
    description: 'URL to the prize thumbnail image',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  imageUrl: string | null;
}

/**
 * DTO for prize configuration response (single tier)
 */
export class PrizeConfigurationDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({
    example: 1,
    description: 'Prize tier number',
  })
  prizeTier: number;

  @ApiProperty({
    example: 500,
    description: 'Coin threshold for this tier',
  })
  amount: number;

  @ApiProperty({
    example: 'Collector',
    description: 'Tier name',
  })
  name: string;

  @ApiProperty({
    example: 'Reach 500 lifetime coins to unlock the Collector badge',
    description: 'Tier description',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    example: 'https://s3.amazonaws.com/...',
    description: 'Badge image URL',
    nullable: true,
  })
  imageUrl: string | null;

  @ApiProperty({
    example: 'slab',
    description: 'Prize category: slab or sealed',
    enum: ['slab', 'sealed'],
  })
  category: string;

  @ApiProperty({
    example: 100,
    description: 'Stock quantity (0 = unlimited/always in stock)',
    minimum: 0,
  })
  stock: number;

  @ApiProperty({
    example: 'both',
    description: 'Purchase option: offers only, buy only, or both',
    enum: PrizePurchaseOption,
  })
  purchaseOption: PrizePurchaseOption;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'uuid', nullable: true })
  createdBy: string | null;

  @ApiProperty({ example: 'uuid', nullable: true })
  updatedBy: string | null;
}

/**
 * DTO for creating a new prize tier (admin only)
 */
export class CreatePrizeTierDto {
  @ApiProperty({
    example: 4,
    description: 'Prize tier number (auto-generated if not provided)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  prizeTier?: number;

  @ApiProperty({
    example: 250000,
    description:
      'Coin threshold for this tier (optional for offers_only, will default to 1)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiProperty({
    example: 'Legend',
    description: 'Display name for the prize tier',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'slab',
    description: 'Prize category: slab or sealed',
    enum: ['slab', 'sealed'],
    required: false,
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    example: 100,
    description: 'Stock quantity (0 = unlimited)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiProperty({
    example: 'both',
    description: 'Purchase option: offers only, buy only, or both',
    enum: PrizePurchaseOption,
    required: false,
  })
  @IsOptional()
  @IsEnum(PrizePurchaseOption)
  purchaseOption?: PrizePurchaseOption;

  @ApiProperty({
    example: 'Reach 250,000 lifetime coins to unlock the Legend badge',
    description: 'Description of the prize',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'https://s3.amazonaws.com/...',
    description: 'URL to the prize thumbnail image',
    required: false,
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

/**
 * DTO for updating an existing prize tier (admin only)
 * Updates create a new row with is_active=true and set old row to is_active=false
 */
export class UpdatePrizeTierDto {
  @ApiProperty({
    example: 4,
    description: 'Prize tier number (will remain the same)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  prizeTier?: number;

  @ApiProperty({
    example: 250000,
    description:
      'Updated coin threshold (optional for offers_only, will default to 1)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiProperty({
    example: 'Legend',
    description: 'Updated display name',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'slab',
    description: 'Prize category: slab or sealed',
    enum: ['slab', 'sealed'],
    required: false,
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    example: 100,
    description: 'Stock quantity (0 = unlimited)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiProperty({
    example: 'both',
    description: 'Purchase option: offers only, buy only, or both',
    enum: PrizePurchaseOption,
    required: false,
  })
  @IsOptional()
  @IsEnum(PrizePurchaseOption)
  purchaseOption?: PrizePurchaseOption;

  @ApiProperty({
    example: 'Reach 250,000 lifetime coins to unlock the Legend badge',
    description: 'Updated description',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'https://s3.amazonaws.com/...',
    description: 'Updated image URL',
    required: false,
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

/**
 * DTO for public prize progress calculation response
 */
export class PrizeProgressDto {
  @ApiProperty({
    example: 500,
    description: 'Current lifetime coins earned',
  })
  lifetimeCoinsEarned: number;

  @ApiProperty({
    example: 5000,
    nullable: true,
    description: 'Next prize threshold amount, null if all prizes achieved',
  })
  nextPrize: number | null;

  @ApiProperty({
    example: 'Dealer',
    nullable: true,
    description: 'Next prize tier name, null if all prizes achieved',
  })
  nextPrizeName: string | null;

  @ApiProperty({
    example: 10,
    description: 'Progress percentage toward next prize (0-100)',
  })
  progressPercent: number;

  @ApiProperty({
    type: [PrizeItemDto],
    description: 'All available prizes with achievement status',
  })
  allPrizes: Array<PrizeItemDto & { achieved: boolean }>;
}

/**
 * DTO for prize redemption response
 */
export class PrizeRedemptionDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'uuid' })
  prizeConfigurationId: string;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  dateRedeemed: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  createdAt: Date;
}
