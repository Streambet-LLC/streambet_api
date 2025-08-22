import {
  CurrencyType,
  CurrencyTypeText,
} from 'src/wallets/entities/transaction.entity';

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
      `Congratulations, you’ve successfully put ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.GOLD_COINS ? CurrencyTypeText.GOLD_COINS_TEXT : CurrencyTypeText.SWEEP_COINS_TEXT}${data.amount !== 1 ? `s` : ''} on ${data.bettingOption} for ‘${data.roundName}’! Feeling Lucky? You can always increase your position`,
    TITLE: () => `Bet Placed Successfully`,
  },
  BET_EDIT: {
    MESSAGE: (data: BetNotificationData) =>
      `You changed your bet to ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.GOLD_COINS ? CurrencyTypeText.GOLD_COINS_TEXT : CurrencyTypeText.SWEEP_COINS_TEXT}${data.amount !== 1 ? `s` : ''} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Modified`,
  },
  BET_CANCELLED: {
    MESSAGE: (data: BetNotificationData) =>
      `"Your bet on ${data.roundName} been cancelled and ${data.amount.toLocaleString('en-US')} ${data.currencyType === CurrencyType.GOLD_COINS ? CurrencyTypeText.GOLD_COINS_TEXT : CurrencyTypeText.SWEEP_COINS_TEXT}${data.amount !== 1 ? `s` : ''} have been returned to your wallet"`,
    TITLE: () => `Bet Cancelled`,
  },

  BET_WON_GOLD_COIN: {
    MESSAGE: (data: BetNotificationData) =>
      `Big winner! ${data.amount.toLocaleString('en-US')} ${CurrencyTypeText.GOLD_COINS_TEXT}${data.amount !== 1 ? `s` : ''} have been added to your wallet. Now imagine if those were Sweepcoins…`,
    TITLE: () => `Win - ${CurrencyTypeText.GOLD_COINS_TEXT}`,
  },
  BET_WON_SWEEP_COIN: {
    MESSAGE: () =>
      `You’re on a roll! Your wallet’s been updated with your winnings. Keep up the good work!`,
    TITLE: () => `Win - ${CurrencyTypeText.SWEEP_COINS_TEXT}`,
  },
  BET_LOST: {
    MESSAGE: (data: BetNotificationData) =>
      `So close! We bet you’ll be on the winning side next time!`,
    TITLE: () => `That was close - better luck next time!`,
  },
  BET_MODIFIED_INCREASE: {
    MESSAGE: (data: BetNotificationData) =>
      `You increased your position to ‘${data.amount.toLocaleString('en-US')}’ - love the confidence! Good luck. Why not check out some more streams while you wait?`,
    TITLE: () => `Bet Modified (Increase)`,
  },
  BET_MODIFIED_DECREASE: {
    MESSAGE: (data: BetNotificationData) =>
      `You decreased your position to ‘${data.amount.toLocaleString('en-US')}’ - try not to doubt yourself, you’ve got this! Why not check out another stream while you wait?`,
    TITLE: () => `Bet Modified (Decrease)`,
  },
  BET_OPEN: {
    MESSAGE: (data: BetNotificationData) =>
      `Hurry, betting is now open! Bets are being accepted for ${data.roundName} of ${data.streamName}. Place yours now before time runs out!`,
    TITLE: () => `Betting Phase Change - Betting Open`,
  },
  BET_LOCKED: {
    MESSAGE: (data: BetNotificationData) =>
      `Time's up! Betting has been locked for ${data.roundName}. Good luck people!`,
    TITLE: () => `Betting Phase Change - Betting Locked`,
  },
  BET_ROUND_VOID: {
    MESSAGE: (data: BetNotificationData) =>
      `"${data.roundName}" has been voided due to technical issues. All bets have been refunded to your wallet.`,
    TITLE: () => `Round Voided`,
  },
  BET_WINNER_DECLARED: {
    MESSAGE: (data: BetNotificationData) =>
      `Results are in… Congrats if you selected ${data.bettingOption}!`,
    TITLE: () => `Winner Declared`,
  },
  EMAIL_BET_WON: {
    TITLE: (data: BetNotificationData) =>
      `🎉 You won a bet on ${data.streamName}! `,
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
      `🎉 You won a bet on ${data.streamName}, but could you have done better?`,
  },
  PLACE_BET_CHAT_MESSAGE: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.username} bet ${data.amount.toLocaleString('en-US')} on ${data.bettingOption}`,
  },
  EDIT_BET_CHAT_MESSAGE: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.username} updated bet to ${data.amount.toLocaleString('en-US')} on ${data.bettingOption}`,
  },
  CANCEL_BET_CHAT_MESSAGE: {
    MESSAGE: (data: BetNotificationData) =>
      `${data.username} cancel bet on ${data.bettingOption}`,
  },
};
