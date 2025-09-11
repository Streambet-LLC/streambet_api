import { Bet } from 'src/betting/entities/bet.entity';
import { CurrencyType } from 'src/wallets/entities/transaction.entity';

export interface EditedBetPayload {
  bet: Bet;
  success: Boolean;
  timestamp: Date;
  currencyType: CurrencyType;
  potentialSweepCoinWinningAmount: number;
  potentialGoldCoinWinningAmount: number;
  amount: number;
  selectedWinner: string;
  updatedWalletBalance: {
    goldCoins: number;
    sweepCoins: number;
  };
  message?: string;
  title?: string;
}
