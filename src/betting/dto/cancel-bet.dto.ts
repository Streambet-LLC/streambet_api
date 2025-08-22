import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsIn, IsNotEmpty, IsUUID } from 'class-validator';
import { CurrencyType } from 'src/wallets/entities/transaction.entity';

export class CancelBetDto {
  @ApiProperty()
  @IsUUID()
  @IsDefined()
  @IsNotEmpty()
  betId: string;

  @ApiProperty()
  @IsIn([CurrencyType.GOLD_COINS, CurrencyType.SWEEP_COINS])
  currencyType: CurrencyType;
}
