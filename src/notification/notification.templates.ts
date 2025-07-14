interface BetNotificationData {
  amount?: number;
  currencyType?: string;
  bettingOption?: string;
  roundName: string;
}

export const NOTIFICATION_TEMPLATE = {
  BET_PLACED: {
    MESSAGE: (data: BetNotificationData) =>
      `You bet ${data.amount} ${data.currencyType}${data.amount !== 1 ? 's' : ''} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Placed Successfully`,
  },
  BET_EDIT: {
    MESSAGE: (data: BetNotificationData) =>
      `You changed your bet to ${data.amount} ${data.currencyType}${data.amount !== 1 ? 's' : ''} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Modified`,
  },
  BET_CANCELLED: {
    MESSAGE: (data: BetNotificationData) =>
      `Your bet of ${data.amount} ${data.currencyType}${data.amount !== 1 ? 's' : ''} on ${data.bettingOption} has been cancelled for ${data.roundName}`,
    TITLE: () => `Bet Cancelled`,
  },
  BET_WON: {
    MESSAGE: (data: BetNotificationData) =>
      `🎉 Congratulations! You won ${data.amount} ${data.currencyType}${data.amount !== 1 ? 's' : ''} in ${data.roundName}. Your wallet has been updated `,
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
};
