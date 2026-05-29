import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsNumber,
  Min,
  ValidateNested,
  IsEnum,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrizeCategory } from '../enums/prize-category.enum';

/**
 * DTO for filtering prize redemptions (admin only)
 */
export class PrizeRedemptionFilterDto {
  @ApiProperty({
    required: false,
    default: '[0,20]',
    description: 'Pagination range [offset, limit]',
  })
  @IsString()
  @IsOptional()
  public range?: string;

  @ApiProperty({
    required: false,
    description: 'Filter by shipping status',
    enum: ['open', 'shipped', 'complete'],
  })
  @IsString()
  @IsOptional()
  public status?: string;
}

/**
 * Shipping address for prize redemption
 */
export class ShippingAddressDto {
  @ApiProperty({ example: '123 Main Street', description: 'Street address' })
  @IsString()
  @IsNotEmpty()
  addressLine1: string;

  @ApiProperty({
    example: 'Apt 4B',
    description: 'Apartment, suite, unit, etc. (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  addressLine2?: string;

  @ApiProperty({ example: 'New York', description: 'City' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'NY', description: 'State or province' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({ example: '10001', description: 'ZIP or postal code' })
  @IsString()
  @IsNotEmpty()
  zipCode: string;

  @ApiProperty({ example: 'United States', description: 'Country' })
  @IsString()
  @IsNotEmpty()
  country: string;
}

/**
 * DTO for submitting a prize redemption
 */
export class SubmitPrizeRedemptionDto {
  @ApiProperty({
    example: 'uuid',
    description: 'Prize configuration ID (UUID of the tier)',
  })
  @IsUUID()
  prizeConfigId: string;

  @ApiProperty({
    example: 1,
    description: 'Prize tier number (1, 2, 3, etc.)',
  })
  @IsNumber()
  @Min(1)
  prizeLevel: number;

  @ApiProperty({
    example: PrizeCategory.SLAB,
    description: 'Selected prize category',
    enum: PrizeCategory,
  })
  @IsEnum(PrizeCategory, { message: 'Invalid prize category' })
  @IsNotEmpty()
  prizeCategory: PrizeCategory;

  @ApiProperty({
    type: ShippingAddressDto,
    description: 'Shipping address for prize delivery',
  })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;
}

/**
 * Shipping status enum
 */
export enum ShippingStatus {
  OPEN = 'open',
  SHIPPED = 'shipped',
  COMPLETE = 'complete',
}

/**
 * DTO for updating redemption shipping status (admin only)
 */
export class UpdateRedemptionStatusDto {
  @ApiProperty({
    enum: ShippingStatus,
    example: ShippingStatus.SHIPPED,
    description: 'New shipping status',
  })
  @IsEnum(ShippingStatus)
  shippingStatus: ShippingStatus;

  @ApiProperty({
    example: '1Z999AA10123456784',
    description: 'Tracking number (required when marking as shipped)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.shippingStatus === ShippingStatus.SHIPPED)
  @IsNotEmpty({
    message: 'Tracking number is required when marking as shipped',
  })
  trackingNumber?: string;

  @ApiProperty({
    example: 'UPS',
    description: 'Shipping carrier (required when marking as shipped)',
    enum: ['USPS', 'UPS', 'FedEx', 'DHL', 'Amazon Logistics', 'Other'],
    required: false,
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.shippingStatus === ShippingStatus.SHIPPED)
  @IsNotEmpty({
    message: 'Shipping carrier is required when marking as shipped',
  })
  shippingCarrier?: string;
}

/**
 * Prize configuration summary for views
 */
export class RedemptionPrizeConfigDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 1 })
  prizeTier: number;

  @ApiProperty({ example: 'Collector' })
  name: string;

  @ApiProperty({ example: 'A special collector tier prize' })
  description: string;

  @ApiProperty({ example: 'https://example.com/image.png' })
  imageUrl: string;

  @ApiProperty({ example: 500 })
  amount: number;
}

/**
 * DTO for user's redemption response (no sensitive address data)
 */
export class UserRedemptionResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid', description: 'User ID' })
  userId: string;

  @ApiProperty({ example: 'uuid', description: 'Prize configuration ID' })
  prizeConfigurationId: string;

  @ApiProperty({ example: 1, description: 'Prize tier number' })
  prizeTier: number;

  @ApiProperty({ example: 'pokemon', description: 'Selected prize category' })
  prizeCategory: string;

  @ApiProperty({
    example: '2025-01-01T00:00:00Z',
    description: 'Date redeemed',
  })
  dateRedeemed: Date;

  @ApiProperty({
    enum: ShippingStatus,
    example: ShippingStatus.OPEN,
    description: 'Current shipping status',
  })
  shippingStatus: ShippingStatus;

  @ApiProperty({
    example: '1Z999AA10123456784',
    nullable: true,
    description: 'Tracking number',
  })
  trackingNumber: string | null;

  @ApiProperty({
    example: 'UPS',
    nullable: true,
    description: 'Shipping carrier',
  })
  shippingCarrier: string | null;

  @ApiProperty({
    example: false,
    description: 'Whether redemption is fulfilled',
  })
  fulfilled: boolean;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  updatedAt: Date;

  @ApiProperty({
    type: RedemptionPrizeConfigDto,
    required: false,
    description: 'Prize configuration details',
  })
  prizeConfiguration?: RedemptionPrizeConfigDto;
}

/**
 * User information with address for admin view
 */
export class RedemptionUserDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'johndoe' })
  username: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({ example: '123 Main Street, Apt 4B' })
  address: string;

  @ApiProperty({ example: 'Apt 4B', required: false })
  address2: string;

  @ApiProperty({ example: 'New York' })
  city: string;

  @ApiProperty({ example: 'NY' })
  state: string;

  @ApiProperty({ example: '10001' })
  zipCode: string;

  @ApiProperty({ example: 'United States' })
  country: string;
}

/**
 * DTO for admin redemption response (includes user address from join)
 */
export class AdminRedemptionResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid', description: 'User ID' })
  userId: string;

  @ApiProperty({ example: 'uuid', description: 'Prize configuration ID' })
  prizeConfigurationId: string;

  @ApiProperty({ example: 1, description: 'Prize tier number' })
  prizeTier: number;

  @ApiProperty({ example: 'pokemon', description: 'Selected prize category' })
  prizeCategory: string;

  @ApiProperty({
    example: '2025-01-01T00:00:00Z',
    description: 'Date redeemed',
  })
  dateRedeemed: Date;

  @ApiProperty({
    enum: ShippingStatus,
    example: ShippingStatus.OPEN,
  })
  shippingStatus: ShippingStatus;

  @ApiProperty({
    example: '1Z999AA10123456784',
    nullable: true,
    description: 'Tracking number',
  })
  trackingNumber: string | null;

  @ApiProperty({
    example: 'UPS',
    nullable: true,
    description: 'Shipping carrier',
  })
  shippingCarrier: string | null;

  @ApiProperty({ example: false })
  fulfilled: boolean;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  updatedAt: Date;

  @ApiProperty({
    type: RedemptionUserDto,
    required: false,
    description: 'User information with current address',
  })
  user?: RedemptionUserDto;

  @ApiProperty({
    type: RedemptionPrizeConfigDto,
    required: false,
    description: 'Prize configuration details',
  })
  prizeConfiguration?: RedemptionPrizeConfigDto;

  @ApiProperty({
    example: 'coins',
    nullable: true,
    description: 'Payment method used (coins, usd, or combined)',
  })
  paymentMethod?: string | null;

  @ApiProperty({
    example: 'us_bank_account',
    nullable: true,
    description:
      'Stripe Checkout method actually used (card vs us_bank_account / ACH). Only meaningful for usd/combined orders.',
  })
  stripePaymentMethod?: 'card' | 'us_bank_account' | null;

  @ApiProperty({
    example: 100,
    nullable: true,
    description: 'CadeCoins deducted for this purchase',
  })
  coinsDeducted?: number | null;

  @ApiProperty({
    example: '9.99',
    nullable: true,
    description: 'USD charged for this purchase',
  })
  usdCharged?: string | null;
}
