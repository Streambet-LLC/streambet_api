import {
  IsUUID,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsNumber,
  IsString,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AddToCartDto {
  @ApiProperty({ description: 'Prize configuration ID to add' })
  @IsUUID()
  prizeConfigurationId: string;

  @ApiPropertyOptional({ description: 'Quantity to add', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;
}

export class UpdateCartItemDto {
  @ApiProperty({ description: 'New quantity' })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;
}

export class CartCheckoutDto {
  @ApiProperty({ description: 'Shipping address' })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;

  @ApiPropertyOptional({
    description:
      'Payment method for CardCade items. Seller items are always USD.',
    enum: ['coins', 'usd', 'combined'],
    default: 'usd',
  })
  @IsOptional()
  @IsEnum(['coins', 'usd', 'combined'])
  cardcadePaymentMethod?: 'coins' | 'usd' | 'combined';

  @ApiPropertyOptional({
    description: 'Coins to apply towards CardCade items (if combined)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  coinsToApply?: number;
}

export class ShippingAddressDto {
  @ApiProperty()
  @IsString()
  addressLine1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiProperty()
  @IsString()
  city: string;

  @ApiProperty()
  @IsString()
  state: string;

  @ApiProperty()
  @IsString()
  zipCode: string;

  @ApiProperty()
  @IsString()
  country: string;
}

export class BundleOfferDto {
  @ApiProperty({
    description: 'Cart item IDs to include in the bundle offer (must be from the same seller)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  cartItemIds: string[];

  @ApiProperty({ description: 'Offer amount in USD for the entire bundle' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  offerAmount: number;

  @ApiPropertyOptional({ description: 'Optional notes for the seller' })
  @IsOptional()
  @IsString()
  offerNotes?: string;

  @ApiProperty({ description: 'Shipping address' })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;
}
