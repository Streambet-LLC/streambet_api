import { Bet } from 'src/betting/entities/bet.entity';
import { CurrencyType } from 'src/wallets/entities/transaction.entity';

export interface EditedBetPayload {
  bet: Bet;
  success: Boolean;
  timestamp: Date;
  currencyType: CurrencyType;
  potentialCoinWinningAmount: number;
  potentialTokenWinningAmount: number;
  amount: number;
  selectedWinner: string;
  updatedWalletBalance: {
    freeTokens: number;
    streamCoins: number;
  };
  message?: string;
  title?: string;
}
