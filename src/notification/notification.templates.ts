export const NOTIFICATION_TEMPLATE = {
  BET_PLACED: {
    MESSAGE: (data) =>
      `You bet${data.amount} ${data.currencyType}s on ${data.bettingOption} for ${data.roundName}`,
    TITLE: () => `Bet Placed Successfully`,
  },
};
