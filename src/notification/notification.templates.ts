import { CurrencyType, CurrencyTypeText } from 'src/enums/currency.enum';

interface BetNotificationData {
  amount?: number;
  currencyType?: string;
  bettingOption?: string;
  roundName?: string;
  streamName?: string;
  username?: string;
}

export const NOTIFICATION_TEMPLATE = {
  BET_PLACED: {
    MESSAGE: (data: BetNotificationData) =>
      `Congratulations, you've successfully put ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.GOLD_COINS ? CurrencyTypeText.GOLD_COINS_TEXT : CurrencyTypeText.SWEEP_COINS_TEXT} on ${data.bettingOption} for '${data.roundName}'! Feeling Lucky? You can always increase your position`,
    TITLE: () => `Pick Placed Successfully`,
  },
  BET_EDIT: {
    MESSAGE: (data: BetNotificationData) =>
      `You changed your Pick to ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.GOLD_COINS ? CurrencyTypeText.GOLD_COINS_TEXT : CurrencyTypeText.SWEEP_COINS_TEXT} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Pick Modified`,
  },
  BET_CANCELLED: {
    MESSAGE: (data: BetNotificationData) =>
      `Your Pick on ${data.roundName} has been cancelled and ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.GOLD_COINS ? CurrencyTypeText.GOLD_COINS_TEXT : CurrencyTypeText.SWEEP_COINS_TEXT} have been returned to your wallet`,
    TITLE: () => `Pick Cancelled`,
  },

  BET_WON_GOLD_COIN: {
    MESSAGE: (data: BetNotificationData) =>
      `Big winner! ${data.amount.toLocaleString('en-US')} ${CurrencyTypeText.GOLD_COINS_TEXT} have been added to your wallet. Now imagine if those were Sweepcoins…`,
    TITLE: () => `Win - ${CurrencyTypeText.GOLD_COINS_TEXT}`,
  },
  BET_WON_SWEEP_COIN: {
    MESSAGE: () =>
      `You’re on a roll! Your wallet’s been updated with your winnings. Keep up the good work!`,
    TITLE: () => `Win - ${CurrencyTypeText.SWEEP_COINS_TEXT}`,
  },
  BET_LOST: {
    MESSAGE: (data: BetNotificationData) =>
      `So close! You’ll be on the winning side next time!`,
    TITLE: () => `That was close - better luck next time!`,
  },
  BET_MODIFIED_INCREASE: {
    MESSAGE: (data: BetNotificationData) =>
      `You increased your position to ‘${data.amount.toLocaleString('en-US')}’ - love the confidence! Good luck. Why not check out some more streams while you wait?`,
    TITLE: () => `Pick Modified (Increase)`,
  },
  BET_MODIFIED_DECREASE: {
    MESSAGE: (data: BetNotificationData) =>
      `You decreased your position to ‘${data.amount.toLocaleString('en-US')}’ - try not to doubt yourself, you’ve got this! Why not check out another stream while you wait?`,
    TITLE: () => `Pick Modified (Decrease)`,
  },
  BET_OPEN: {
    MESSAGE: (data: BetNotificationData) =>
      `Hurry, Picks are now open! Picks are being accepted for ${data.roundName} of ${data.streamName}. Place yours now before time runs out!`,
    TITLE: () => `Picks Phase Change - Picks Open`,
  },
  BET_LOCKED: {
    MESSAGE: (data: BetNotificationData) =>
      `Time's up! Picks have been locked for ${data.roundName}. Good luck people!`,
    TITLE: () => `Picks Phase Change - Picks Locked`,
  },
  BET_ROUND_VOID: {
    MESSAGE: (data: BetNotificationData) =>
      `"${data.roundName}" has been voided due to technical issues. All Picks have been refunded to your wallet.`,
    TITLE: () => `Round Voided`,
  },
  BET_WINNER_DECLARED: {
    MESSAGE: (data: BetNotificationData) =>
      `Results are in… Congrats if you selected ${data.bettingOption}!`,
    TITLE: () => `Winner Declared`,
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
      `You've passed go, collect 1000 ${CurrencyTypeText.GOLD_COINS_TEXT}`,
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
    MESSAGE: (data: BetNotificationData) =>
      `${data.username} updated Pick to ${data.amount.toLocaleString('en-US')} on ${data.bettingOption}`,
  },
  CANCEL_BET_CHAT_MESSAGE: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.username} canceled Pick on ${data.bettingOption}`,
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
