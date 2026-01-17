import { IsDefined, IsEnum, IsNotEmpty, IsNumber, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CurrencyType } from 'src/enums/currency.enum';

export class UpdateCoinDto {
  @ApiProperty({
    description: 'The UUID of the user',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'The new balance to set',
    example: 1000,
    type: 'number',
  })
  @IsNumber()
  @IsDefined()
  @IsNotEmpty()
  amount: number;

  @ApiProperty({
    description: 'Currency type',
    enum: CurrencyType,
    example: CurrencyType.GOLD_COINS,
  })
  @IsEnum(CurrencyType)
  @IsNotEmpty()
  currencyType: CurrencyType;
}

// Keep legacy DTO for backward compatibility
export class AddGoldCoinDto {
  @ApiProperty({
    description: 'The UUID of the user to add gold coins to',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description:
      'The amount of gold coins to add (can be negative to subtract)',
    example: 1000,
    type: 'number',
  })
  @IsNumber()
  @IsDefined()
  @IsNotEmpty()
  amount: number;
}
