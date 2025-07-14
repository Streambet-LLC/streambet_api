export const NOTIFICATION_TEMPLATE = {
  BET_PLACED: {
    MESSAGE: (data) =>
      `You bet${data.amount} ${data.currencyType}s on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Placed Successfully`,
  },
  BET_EDIT: {
    MESSAGE: (data) =>
      `You changed your bet to ${data.amount} ${data.currencyType} on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Modified`,
  },
};
