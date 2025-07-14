interface BetNotificationData {
  amount: number;
  currencyType: string;
  bettingOption: string;
  roundName: string;
}

export const NOTIFICATION_TEMPLATE = {
  BET_PLACED: {
    MESSAGE: (data: BetNotificationData) =>
      `You bet${data.amount} ${data.currencyType}${data.amount !== 1 ? 's' : ''} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Placed Successfully`,
  },
  BET_EDIT: {
    MESSAGE: (data: BetNotificationData) =>
      `You changed your bet to ${data.amount} ${data.currencyType}${data.amount !== 1 ? 's' : ''} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Modified`,
  },
  BET_CANCELLED: {
    MESSAGE: (data: BetNotificationData) =>
      `Your bet of ${data.amount} ${data.currencyType}${data.amount !== 1 ? 's' : ''} on ${data.bettingOption}  has been cancelled for ${data.roundName}`,
    TITLE: () => `Bet Cancelled`,
  },
};
