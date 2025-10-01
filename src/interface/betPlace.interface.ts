import { Bet } from 'src/betting/entities/bet.entity';
import { CurrencyType } from 'src/enums/currency.enum';

export interface PlaceBetResult {
  bet: Bet;
  success: boolean;
  currencyType: CurrencyType;
  potentialSweepCoinWinningAmount: any;
  potentialGoldCoinWinningAmount: any;
  amount: number;
  selectedWinner: string;
  message?: string;
  title?: string;
  updatedWalletBalance: {
    goldCoins: number;
    sweepCoins: number;
  };
}
