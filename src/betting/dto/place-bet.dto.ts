import {
  IsNotEmpty,
  IsNumber,
  IsUUID,
  IsPositive,
  IsIn,
} from 'class-validator';
import { CurrencyType } from '../../wallets/entities/transaction.entity';
import { ApiProperty } from '@nestjs/swagger';

export class PlaceBetDto {
<<<<<<< HEAD
  @ApiProperty({
    description: 'The ID of the betting variable to place a bet on',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  bettingVariableId: string;

  @ApiProperty({
    description: 'The amount to bet',
    example: 1000,
    type: 'number',
    minimum: 1,
  })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({
    description: 'The type of currency to use for the bet',
    example: CurrencyType.FREE_TOKENS,
    enum: [CurrencyType.FREE_TOKENS, CurrencyType.STREAM_COINS],
    enumName: 'CurrencyType',
  })
=======
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  bettingVariableId: string;
  @ApiProperty()
  @IsNumber()
  @IsPositive()
  amount: number;
  @ApiProperty()
>>>>>>> dev
  @IsIn([CurrencyType.FREE_TOKENS, CurrencyType.STREAM_COINS])
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
    example: CurrencyType.STREAM_COINS,
    enum: [CurrencyType.FREE_TOKENS, CurrencyType.STREAM_COINS],
    enumName: 'CurrencyType',
  })
  @IsIn([CurrencyType.FREE_TOKENS, CurrencyType.STREAM_COINS])
  newCurrencyType: CurrencyType;
}
