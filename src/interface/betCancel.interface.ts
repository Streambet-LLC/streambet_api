import { Bet } from 'src/betting/entities/bet.entity';

export interface CancelBetPayout {
  bet: Bet;
  success: boolean;
  message?: string;
  title?: string;
  updatedWalletBalance: {
    freeTokens: number;
    streamCoins: number;
  };
}
