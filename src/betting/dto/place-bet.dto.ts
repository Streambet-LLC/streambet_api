import {
  IsNotEmpty,
  IsNumber,
  IsUUID,
  IsPositive,
  IsIn,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CurrencyType } from 'src/enums/currency.enum';

export class CurrencyTypeDto {
  @ApiProperty({
    required: false,
  })
  @IsIn([CurrencyType.GOLD_COINS, CurrencyType.SWEEP_COINS])
  @IsOptional()
  currencyType?: CurrencyType;
}

export class RoundIdDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  roundId?: string;
}
export class PlaceBetDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  bettingVariableId: string;
  @ApiProperty()
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty()
  @IsIn([CurrencyType.GOLD_COINS, CurrencyType.SWEEP_COINS])
  currencyType: CurrencyType;
}

export class EditBetDto {
  @ApiProperty({
    description: 'The ID of the bet to edit',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  betId: string;

  @ApiProperty({
    description: 'The new betting variable ID to change the bet to',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  newBettingVariableId: string;

  @ApiProperty({
    description: 'The new amount to bet',
    example: 1500,
    type: 'number',
    minimum: 1,
  })
  @IsNumber()
  @IsPositive()
  newAmount: number;

  @ApiProperty({
    description: 'The new currency type to use for the bet',
    example: CurrencyType.SWEEP_COINS,
    enum: [CurrencyType.GOLD_COINS, CurrencyType.SWEEP_COINS],
    enumName: 'CurrencyType',
  })
  @IsIn([CurrencyType.GOLD_COINS, CurrencyType.SWEEP_COINS])
  newCurrencyType: CurrencyType;
}
