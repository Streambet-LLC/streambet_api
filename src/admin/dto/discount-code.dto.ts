import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsIn,
  Min,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDiscountCodeDto {
  @ApiProperty({ description: 'Unique code (will be uppercased)' })
  @IsString()
  code: string;

  @ApiProperty({
    description: '"percent" or "fixed_amount"',
    enum: ['percent', 'fixed_amount'],
  })
  @IsIn(['percent', 'fixed_amount'])
  discountType: 'percent' | 'fixed_amount';

  @ApiPropertyOptional({ description: 'Percentage off (e.g. 10 = 10%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPercent?: number;

  @ApiPropertyOptional({
    description: 'Fixed discount in cents (e.g. 500 = $5.00)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmountCents?: number;

  @ApiProperty({
    description: '"per_account" or "single_use"',
    enum: ['per_account', 'single_use'],
  })
  @IsIn(['per_account', 'single_use'])
  usageType: 'per_account' | 'single_use';

  @ApiPropertyOptional({
    description: 'Max total uses. null = unlimited',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @ApiProperty({
    description: '"cart" or "cheapest_item"',
    enum: ['cart', 'cheapest_item'],
    default: 'cart',
  })
  @IsIn(['cart', 'cheapest_item'])
  scope: 'cart' | 'cheapest_item';

  @ApiPropertyOptional({ description: 'Expiration date (ISO string)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateDiscountCodeDto {
  @ApiPropertyOptional({
    description: '"percent" or "fixed_amount"',
    enum: ['percent', 'fixed_amount'],
  })
  @IsOptional()
  @IsIn(['percent', 'fixed_amount'])
  discountType?: 'percent' | 'fixed_amount';

  @ApiPropertyOptional({ description: 'Percentage off (e.g. 10 = 10%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPercent?: number;

  @ApiPropertyOptional({
    description: 'Fixed discount in cents (e.g. 500 = $5.00)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmountCents?: number;

  @ApiPropertyOptional({
    description: '"per_account" or "single_use"',
    enum: ['per_account', 'single_use'],
  })
  @IsOptional()
  @IsIn(['per_account', 'single_use'])
  usageType?: 'per_account' | 'single_use';

  @ApiPropertyOptional({
    description: 'Max total uses. null = unlimited',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number | null;

  @ApiPropertyOptional({
    description: '"cart" or "cheapest_item"',
    enum: ['cart', 'cheapest_item'],
  })
  @IsOptional()
  @IsIn(['cart', 'cheapest_item'])
  scope?: 'cart' | 'cheapest_item';

  @ApiPropertyOptional({ description: 'Whether the code is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Expiration date (ISO string)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
