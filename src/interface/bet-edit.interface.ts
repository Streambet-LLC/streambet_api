import { Bet } from 'src/betting/entities/bet.entity';
import { CurrencyType } from 'src/enums/currency.enum';
export interface EditedBetPayload {
  bet: Bet;
  success: boolean;
  timestamp: Date;
  currencyType: CurrencyType;
  potentialSweepCoinWinningAmount: number;
  potentialGoldCoinWinningAmount: number;
  potentialCadeCoinWinningAmount: number;
  amount: number;
  selectedWinner: string;
  updatedWalletBalance: {
    goldCoins: number;
    sweepCoins: number;
    cadeCoins: number;
  };
  message?: string;
  title?: string;
}
