import {
  IsNotEmpty,
  IsNumber,
  IsUUID,
  IsPositive,
  IsIn,
} from 'class-validator';
import { CurrencyType } from '../../wallets/entities/transaction.entity';

export class PlaceBetDto {
  @IsUUID()
  @IsNotEmpty()
  bettingVariableId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsIn([CurrencyType.FREE_TOKENS, CurrencyType.STREAM_COINS])
  currencyType: CurrencyType;
}
