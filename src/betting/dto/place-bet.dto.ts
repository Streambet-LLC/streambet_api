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
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  bettingVariableId: string;
  @ApiProperty()
  @IsNumber()
  @IsPositive()
  amount: number;
  @ApiProperty()
  @IsIn([CurrencyType.FREE_TOKENS, CurrencyType.STREAM_COINS])
  currencyType: CurrencyType;
}
