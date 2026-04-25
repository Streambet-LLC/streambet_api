import Stripe from 'stripe';

const stripeConfig = new Stripe(process.env.STRIPE_SECRET_KEY);

const createConnectedAccount = async (email) => {
  const account = await stripeConfig.accounts.create({
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    controller: {
      losses: {
        payments: 'stripe',
      },
      fees: {
        payer: 'account',
      },
      stripe_dashboard: {
        type: 'full',
      },
    },
  });

  return { accountId: account.id };
};

const createAccountLink = async (accountId) => {
  console.log(accountId);

  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );

  const accountLink = await stripeConfig.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: `${clientUrl}/seller/shop/manage`,
    refresh_url: `${clientUrl}/seller/shop/manage`,
  });

  return accountLink.url;
};

const registerProduct = async (
  productName,
  productDescription,
  price,
  accountId,
) => {
  const product = await stripeConfig.products.create({
    name: productName,
    description: productDescription,
    metadata: { stripeAccount: accountId },
  });

  await stripeConfig.prices.create({
    product: product.id,
    unit_amount: price,
    currency: 'usd',
  });

  return product.id;
};

const retrieveAccount = async (accountId: string): Promise<Stripe.Account> => {
  return stripeConfig.accounts.retrieve(accountId);
};

const constructWebhookEvent = (
  rawBody: Buffer,
  signature: string,
  secret: string,
) => {
  return stripeConfig.webhooks.constructEvent(rawBody, signature, secret);
};

export const stripe = {
  createConnectedAccount,
  createAccountLink,
  registerProduct,
  retrieveAccount,
  constructWebhookEvent,
};
