import Stripe from 'stripe';

const stripeConfig = new Stripe(process.env.STRIPE_SECRET_KEY);

const createConnectedAccount = async (email) => {
    const account = await stripeConfig.accounts.create({
        business_type: "individual",
        email,

    });

    return { accountId: account.id };
}

const createAccountLink = async (accountId) => {
    console.log(process.env.CLIENT_URL + "stripe-connect/success",);

    const accountLink = await stripeConfig.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        return_url: process.env.CLIENT_URL + "seller/shop/manage",
        refresh_url: process.env.CLIENT_URL + "seller/shop/manage",
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

export const stripe = {
    createConnectedAccount,
    createAccountLink,
    registerProduct
};