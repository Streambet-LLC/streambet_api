import {
  IsNotEmpty,
  IsNumber,
  IsUUID,
  IsPositive,
  IsIn,
  IsOptional,
} from 'class-validator';
import { CurrencyType } from '../../wallets/entities/transaction.entity';
import { ApiProperty } from '@nestjs/swagger';

export class CurrencyTypeDto {
  @ApiProperty({
    required: false,
  })
  @IsIn([CurrencyType.FREE_TOKENS, CurrencyType.SWEEP_COINS])
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
  @IsIn([CurrencyType.FREE_TOKENS, CurrencyType.SWEEP_COINS])
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
    enum: [CurrencyType.FREE_TOKENS, CurrencyType.SWEEP_COINS],
    enumName: 'CurrencyType',
  })
  @IsIn([CurrencyType.FREE_TOKENS, CurrencyType.SWEEP_COINS])
  newCurrencyType: CurrencyType;
}
