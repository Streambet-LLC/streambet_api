import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePromoCodeDto {
  @ApiProperty({ description: 'Unique code (will be uppercased)' })
  @IsString()
  code: string;

  @ApiProperty({ description: 'CADE coin amount to grant on signup' })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ description: 'Whether the code is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Expiration date (ISO string)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdatePromoCodeDto {
  @ApiPropertyOptional({ description: 'CADE coin amount to grant on signup' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: 'Whether the code is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Expiration date (ISO string)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
