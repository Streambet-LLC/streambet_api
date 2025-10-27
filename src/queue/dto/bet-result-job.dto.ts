import { CurrencyType } from 'src/enums/currency.enum';

export interface BetResultJobData {
  userId: string;
  streamId: string;
  streamName: string;
  roundName: string;
  won: boolean;
  amount: number;
  currency: CurrencyType;
  timestamp: string; // ISO string for JSON serialization
}

export interface StreamSummaryJobData {
  streamId: string;
  streamName: string;
}

export interface UserBetSummary {
  userId: string;
  streamId: string;
  streamName: string;
  rounds: Array<{
    roundName: string;
    won: boolean;
    amount: number;
    currency: CurrencyType;
  }>;
}
