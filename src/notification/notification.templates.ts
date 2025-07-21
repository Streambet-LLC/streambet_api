import { CurrencyType } from 'src/wallets/entities/transaction.entity';

interface BetNotificationData {
  amount?: number;
  currencyType?: string;
  bettingOption?: string;
  roundName?: string;
  streamName?: string;
}

export const NOTIFICATION_TEMPLATE = {
  BET_PLACED: {
    MESSAGE: (data: BetNotificationData) =>
      `You bet ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.FREE_TOKENS ? 'free token' : 'stream coin'}${data.amount !== 1 ? `'s` : ''} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Placed Successfully`,
  },
  BET_EDIT: {
    MESSAGE: (data: BetNotificationData) =>
      `You changed your bet to ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.FREE_TOKENS ? 'free token' : 'stream coin'}${data.amount !== 1 ? `'s` : ''} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Modified`,
  },
  BET_CANCELLED: {
    MESSAGE: (data: BetNotificationData) =>
      `Your bet of ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.FREE_TOKENS ? 'free token' : 'stream coin'}${data.amount !== 1 ? `'s` : ''} on ${data.bettingOption} has been cancelled for ${data.roundName}`,
    TITLE: () => `Bet Cancelled`,
  },
  BET_WON: {
    MESSAGE: (data: BetNotificationData) =>
      `🎉 Congratulations! You won ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.FREE_TOKENS ? 'free token' : 'stream coin'}${data.amount !== 1 ? `'s` : ''} in ${data.roundName}. Your wallet has been updated `,
    TITLE: () => `🎉 Oh Snap! You Won!`,
  },
  BET_LOST: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.roundName} has ended and unfortunately you Lost. Better luck next time!`,
    TITLE: () => `You Lost 😭`,
  },
  BET_OPEN: {
    MESSAGE: (data: BetNotificationData) =>
      `Betting is open for ${data.roundName}. Place your bets and good luck!`,
    TITLE: () => `Betting Phase Change - Betting Open`,
  },
  BET_LOCKED: {
    MESSAGE: (data: BetNotificationData) =>
      `Betting has been locked for ${data.roundName}. Results will be announced shortly.`,
    TITLE: () => `Betting Phase Change - Betting Locked`,
  },
  BET_ROUND_VOID: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.roundName} has been voided due to technical issues. All bets have been refunded to your wallet.`,
    TITLE: () => `Round Voided`,
  },
  EMAIL_BET_WON: {
    TITLE: (data: BetNotificationData) =>
      `🎉 You won a bet on ${data.streamName}! `,
  },
  EMAIL_BET_LOSS: {
    TITLE: (data: BetNotificationData) =>
      `${data.streamName} round complete! See your results... `,
  },
  EMAIL_WELCOME: {
    TITLE: () => `Welcome to Streambet! Here's 1000 Free Tokens 🙌`,
  },
  EMAIL_PASSWORD_RESET: {
    TITLE: () => `Password Reset Request`,
  },
  EMAIL_FREE_COIN_WON: {
    TITLE: (data: BetNotificationData) =>
      `🎉 You won a bet on ${data.streamName}, but could you have done better?`,
  },
};
