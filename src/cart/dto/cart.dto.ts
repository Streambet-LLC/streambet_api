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

export class ShippingAddressDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastName: string;

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

  @ApiPropertyOptional({
    description: 'Discount code to apply to the order',
  })
  @IsOptional()
  @IsString()
  discountCode?: string;

  @ApiPropertyOptional({
    description:
      'Stripe Checkout payment method the buyer chose. Required when the cart contains any USD items so the server can restrict the hosted Checkout to that single method and apply the correct buyer fee tier (card = 3%, us_bank_account = 0.8%).',
    enum: ['card', 'us_bank_account'],
  })
  @IsOptional()
  @IsEnum(['card', 'us_bank_account'])
  stripePaymentMethod?: 'card' | 'us_bank_account';
}

export class ValidateDiscountCodeDto {
  @ApiProperty({ description: 'Discount code to validate' })
  @IsString()
  code: string;
}

export class BundleOfferDto {
  @ApiProperty({
    description:
      'Cart item IDs to include in the bundle offer (must be from the same seller)',
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
