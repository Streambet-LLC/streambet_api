import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsEnum,
  IsNotEmpty,
  ValidateNested,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export type PaymentMethod = 'coins' | 'usd' | 'combined';

export class ShippingAddressDto {
  @ApiProperty({ example: '123 Main St' })
  @IsString()
  @IsNotEmpty()
  addressLine1: string;

  @ApiProperty({ example: 'Apt 4B', nullable: true })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiProperty({ example: 'New York' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'NY' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({ example: '10001' })
  @IsString()
  @IsNotEmpty()
  zipCode: string;

  @ApiProperty({ example: 'United States' })
  @IsString()
  @IsNotEmpty()
  country: string;
}

export class CreatePrizeOrderDto {
  @ApiProperty({ description: 'Prize configuration ID' })
  @IsString()
  @IsNotEmpty()
  prizeConfigId: string;

  @ApiProperty({ type: ShippingAddressDto })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;

  @ApiProperty({ enum: ['coins', 'usd', 'combined'] })
  @IsEnum(['coins', 'usd', 'combined'])
  paymentMethod: PaymentMethod;

  @ApiProperty({
    example: 0,
    description: 'Amount of coins to use (0 for USD-only)',
  })
  @IsNumber()
  @Min(0)
  coinsAmount: number;

  @ApiProperty({
    example: 10.99,
    description: 'Amount in USD (0 for coins-only)',
  })
  @IsNumber()
  @Min(0)
  usdAmount: number;

  @ApiProperty({
    example: 10.99,
    description: 'Total price in USD (coins converted at 50:1)',
  })
  @IsNumber()
  @Min(0)
  totalPrice: number;
}

export class PrizeOrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  prizeConfigId: string;

  @ApiProperty()
  shippingAddress: ShippingAddressDto;

  @ApiProperty()
  paymentMethod: PaymentMethod;

  @ApiProperty()
  coinsDeducted: number;

  @ApiProperty()
  usdCharged: number;

  @ApiProperty()
  totalPrice: number;

  @ApiProperty({ nullable: true })
  offerAmount?: number;

  @ApiProperty({ nullable: true })
  counterOfferAmount?: number;

  @ApiProperty({ nullable: true })
  offerNotes?: string;

  @ApiProperty({ nullable: true })
  stripeSessionId?: string;

  @ApiProperty({
    enum: [
      'pending',
      'paid',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'offer_made',
      'countered',
      'rejected',
      'offer_accepted',
    ],
  })
  status:
    | 'pending'
    | 'paid'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'offer_made'
    | 'countered'
    | 'rejected'
    | 'offer_accepted';

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiProperty({ nullable: true })
  user?: {
    username: string;
    email: string;
  };

  @ApiProperty({ nullable: true })
  prizeConfig?: {
    name: string;
    category: string;
  };
}

export class MakeOfferDto {
  @ApiProperty({ description: 'Prize configuration ID' })
  @IsString()
  @IsNotEmpty()
  prizeConfigId: string;

  @ApiProperty({ type: ShippingAddressDto })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;

  @ApiProperty({
    example: 50.0,
    description: 'Offer amount in USD',
  })
  @IsNumber()
  @Min(0.01)
  offerAmount: number;

  @ApiProperty({
    example: 'Would like a discount for bulk purchase',
    description: 'Optional notes for the offer',
    required: false,
  })
  @IsOptional()
  @IsString()
  offerNotes?: string;
}

export class CounterOfferDto {
  @ApiProperty({
    example: 75.0,
    description: 'Counter offer amount in USD',
  })
  @IsNumber()
  @Min(0.01)
  counterOfferAmount: number;

  @ApiProperty({
    example: 'Best we can do is $75',
    description: 'Optional notes for the counter offer',
    required: false,
  })
  @IsOptional()
  @IsString()
  offerNotes?: string;
}