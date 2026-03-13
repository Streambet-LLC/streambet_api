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
                payments: "stripe"
            },
            fees: {
                payer: "account"
            },
            stripe_dashboard: {
                type: "full"
            }
        }
    });

    return { accountId: account.id };
}

const createAccountLink = async (accountId) => {
    console.log(accountId);

    const accountLink = await stripeConfig.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        // return_url: process.env.CLIENT_URL + "seller/shop/manage",
        // refresh_url: process.env.CLIENT_URL + "seller/shop/manage",
        return_url: "https://cardcade.fun/seller/shop/manage",
        refresh_url: "https://cardcade.fun/seller/shop/manage",
    });

    return accountLink.url;
}

const registerProduct = async (productName, productDescription, price, accountId) => {
    const product = await stripeConfig.products.create({
        name: productName,
        description: productDescription,
        metadata: { stripeAccount: accountId }
    });

    await stripeConfig.prices.create({
        product: product.id,
        unit_amount: price,
        currency: 'usd',
    });

    return product.id;
}

const constructWebhookEvent = (rawBody: Buffer, signature: string, secret: string) => {
    return stripeConfig.webhooks.constructEvent(rawBody, signature, secret);
}

export const stripe = {
    createConnectedAccount,
    createAccountLink,
    registerProduct,
    constructWebhookEvent,
};