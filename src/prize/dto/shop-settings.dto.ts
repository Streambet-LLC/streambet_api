import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  ValidateIf,
} from 'class-validator';

/**
 * DTO for shop settings response
 */
export class ShopSettingsDto {
  @ApiProperty({ example: 'cardcade' })
  shopKey: string;

  @ApiProperty({ example: 'CardCade Shop', nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true })
  profileImageUrl: string | null;

  @ApiProperty({ nullable: true })
  socials: Record<string, string> | null;

  @ApiProperty({ nullable: true })
  sellerTradingExperience: string | null;

  @ApiProperty({ nullable: true })
  city: string | null;

  @ApiProperty({ nullable: true })
  state: string | null;

  @ApiProperty({ nullable: true })
  country: string | null;

  @ApiProperty({
    example: false,
    description:
      'Whether this virtual shop accepts USDC (Solana) payments. Mirrors User.cryptoPaymentsEnabled for individual sellers.',
  })
  cryptoPaymentsEnabled: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'Solana wallet address (base58) that receives USDC for this shop.',
  })
  cryptoWalletAddress: string | null;
}

/**
 * DTO for updating shop settings
 */
export class UpdateShopSettingsDto {
  @ApiProperty({ example: 'CardCade Shop', required: false })
  @IsOptional()
  @IsString()
  shopName?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  profileImageUrl?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  socials?: Record<string, string>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sellerTradingExperience?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  cryptoPaymentsEnabled?: boolean;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  cryptoWalletAddress?: string | null;
}
