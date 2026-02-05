import { CurrencyType } from 'src/enums/currency.enum';
import { formatCurrencyType } from 'src/common/utils/currency-utils';

interface BetNotificationData {
  amount?: number;
  currencyType?: string;
  bettingOption?: string;
  originalOption?: string;
  roundName?: string;
  streamName?: string;
  username?: string;
  mechanism?: string;
}

export const NOTIFICATION_TEMPLATE = {
  BET_PLACED: {
    MESSAGE: (data: BetNotificationData) =>
      data.mechanism === 'sentiment'
        ? `You picked ${data.bettingOption} on '${data.roundName}'!`
        : `You put ${data.amount.toLocaleString('en-US')} ${formatCurrencyType(data.currencyType)} on ${data.bettingOption} for '${data.roundName}'!`,
    TITLE: () => `Pick Placed Successfully`,
  },
  BET_EDIT: {
    MESSAGE: (data: BetNotificationData) =>
      `You changed your Pick to ${data.amount.toLocaleString('en-US')} ${formatCurrencyType(data.currencyType)} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Pick Modified`,
  },
  BET_CANCELLED: {
    MESSAGE: (data: BetNotificationData) =>
      `Your Pick on '${data.roundName}' has been cancelled and ${data.amount.toLocaleString('en-US')} ${formatCurrencyType(data.currencyType)} were returned to your wallet`,
    TITLE: () => `Pick Cancelled`,
  },

  BET_WON_GOLD_COIN: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.amount.toLocaleString('en-US')} ${formatCurrencyType(CurrencyType.GOLD_COINS)} were added to your wallet.`,
    TITLE: () => `You Won!`,
  },
  BET_WON_SWEEP_COIN: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.amount.toLocaleString('en-US')} ${formatCurrencyType(CurrencyType.SWEEP_COINS)} were added to your wallet.`,
    TITLE: () => `You Won!`,
  },
  BET_WON_CADE_COIN: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.amount.toLocaleString('en-US')} ${formatCurrencyType(CurrencyType.CADE_COINS)} were added to your wallet.`,
    TITLE: () => `You Won!`,
  },
  BET_LOST: {
    MESSAGE: (data: BetNotificationData) =>
      `'${data.roundName}' didn't go your way. Better luck next time!`,
    TITLE: () => `You Lost!`,
  },
  BET_MODIFIED_INCREASE: {
    MESSAGE: (data: BetNotificationData) =>
      `You increased your position to ${data.amount.toLocaleString('en-US')} ${formatCurrencyType(data.currencyType)}`,
    TITLE: () => `Pick Modified (Increase)`,
  },
  BET_MODIFIED_DECREASE: {
    MESSAGE: (data: BetNotificationData) =>
      `You decreased your position to ${data.amount.toLocaleString('en-US')} ${formatCurrencyType(data.currencyType)}`,
    TITLE: () => `Pick Modified (Decrease)`,
  },
  BET_OPEN: {
    MESSAGE: (data: BetNotificationData) =>
      `Picks are open for ${data.streamName} - ${data.roundName}`,
    TITLE: () => `Round Open`,
  },
  BET_LOCKED: {
    MESSAGE: (data: BetNotificationData) =>
      `Picks have been locked for ${data.roundName}.`,
    TITLE: () => `Round Locked`,
  },
  BET_ROUND_VOID: {
    MESSAGE: (data: BetNotificationData) =>
      `'${data.roundName}' has been voided. No one bet on the other side! All Picks have been refunded to your wallet.`,
    TITLE: () => `Round Voided`,
  },
  BET_WINNER_DECLARED: {
    MESSAGE: (data: BetNotificationData) => `${data.bettingOption}!`,
    TITLE: () => `Winner Declared!`,
  },
  EMAIL_BET_WON: {
    TITLE: (data: BetNotificationData) =>
      `🎉 You won a Pick on ${data.streamName}! `,
  },
  EMAIL_BET_LOSS: {
    TITLE: (data: BetNotificationData) =>
      `Round Complete - Click to see if you won...`,
  },
  EMAIL_WELCOME: {
    TITLE: () =>
      `You've passed go, collect 1000 ${formatCurrencyType(CurrencyType.GOLD_COINS)}`,
  },
  EMAIL_PASSWORD_RESET: {
    TITLE: () => `Password Reset Request`,
  },
  EMAIL_GOLD_COIN_WON: {
    TITLE: (data: BetNotificationData) =>
      `🎉 You won a Pick on ${data.streamName}, but could you have done better?`,
  },
  PLACE_BET_CHAT_MESSAGE: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.username} Picks ${data.amount.toLocaleString('en-US')} on ${data.bettingOption}`,
  },
  EDIT_BET_CHAT_MESSAGE: {
    MESSAGE: (data: BetNotificationData & { originalAmount?: number }) => {
      const amountChanged = data.originalAmount !== data.amount;
      const optionChanged = data.originalOption !== data.bettingOption;

      if (amountChanged && optionChanged) {
        return `${data.username} changed Pick to ${data.amount.toLocaleString('en-US')} on ${data.bettingOption}`;
      } else if (optionChanged) {
        return `${data.username} switched Pick from ${data.originalOption} to ${data.amount.toLocaleString('en-US')} on ${data.bettingOption}`;
      } else {
        return `${data.username} updated Pick from ${data.originalAmount?.toLocaleString('en-US')} to ${data.amount.toLocaleString('en-US')} on ${data.bettingOption}`;
      }
    },
  },
  CANCEL_BET_CHAT_MESSAGE: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.username} cancelled their Pick of ${data.amount.toLocaleString('en-US')} on ${data.bettingOption}`,
  },
  EMAIL_COIN_PURCHASED: {
    TITLE: () => `Gold Coins Added to Your Account`,
  },
  EMAIL_BETTING_SUMMARY: {
    TITLE: (data: BetNotificationData) => {
      const name = data.streamName ?? 'the stream';
      return `Your Pick Summary for ${name}`;
    },
  },
};
