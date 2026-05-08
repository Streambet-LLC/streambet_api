import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  // Determine if we should use MailHog based on NODE_ENV
  USE_MAILHOG: false,

  // MailHog Configuration (Development)
  MAILHOG_HOST: process.env.MAILHOG_HOST || 'localhost',
  MAILHOG_PORT: parseInt(process.env.MAILHOG_PORT || '1025', 10),

  // AWS SES Configuration (Production/Staging)
  SMTP_USER: process.env.AWS_SMTP_USER,
  SMTP_PASSWORD: process.env.AWS_SMTP_PASSWORD,
  SMTP_PORT: process.env.AWS_SMTP_PORT,
  SMTP_HOST: process.env.AWS_SMTP_HOST,
  // Use MAIL_SECURE env to control TLS; default to false (STARTTLS) - port 587
  SMTP_SECURE: (process.env.MAIL_SECURE || 'false').toLowerCase() === 'true',
  defaultName: process.env.MAIL_DEFAULT_NAME,
  FROM_EMAIL: process.env.AWS_EMAIL_FROM,
  SMTP_REGION: process.env.AWS_SMTP_REGION,
  APPLICATION_HOST: process.env.APPLICATION_HOST || '',
  HOST_URL: process.env.APP_HOST_URL || '',
  HOSTED: process.env.HOSTED,
  ttls: {
    eightHours: 28800000,
    fullDay: 86400,
    fourHours: 14400000,
    fiveMinutes: 300000,
    oneHour: 3600000,
    tenSec: 10000,
  },
  schemaMapping: {
    account_verification: {
      templatePath: './src/templates/account_verification.ejs',
      schemaPath: './src/templates/account_verification.json',
    },
    password_reset: {
      templatePath: './src/templates/password_reset.ejs',
      schemaPath: './src/templates/password_reset.json',
    },
    welcome: {
      templatePath: './src/templates/welcome.ejs',
      schemaPath: './src/templates/welcome.json',
    },
    bet_won: {
      templatePath: './src/templates/bet_won.ejs',
      schemaPath: './src/templates/bet_won.json',
    },
    bet_loss: {
      templatePath: './src/templates/bet_loss.ejs',
      schemaPath: './src/templates/bet_loss.json',
    },
    bet_won_gold_coin: {
      templatePath: './src/templates/bet_won_gold_coin.ejs',
      schemaPath: './src/templates/bet_won_gold_coin.json',
    },
    coin_purchase: {
      templatePath: './src/templates/coin_purchase.ejs',
      schemaPath: './src/templates/coin_purchase.json',
    },
    betting_stream_summary: {
      templatePath: './src/templates/betting_stream_summary.ejs',
      schemaPath: './src/templates/betting_stream_summary.json',
    },
    prize_shipped: {
      templatePath: './src/templates/prize_shipped.ejs',
      schemaPath: './src/templates/prize_shipped.json',
    },
    offer_made: {
      templatePath: './src/templates/offer_made.ejs',
      schemaPath: './src/templates/offer_made.json',
    },
    offer_countered: {
      templatePath: './src/templates/offer_countered.ejs',
      schemaPath: './src/templates/offer_countered.json',
    },
    offer_accepted: {
      templatePath: './src/templates/offer_accepted.ejs',
      schemaPath: './src/templates/offer_accepted.json',
    },
    offer_rejected: {
      templatePath: './src/templates/offer_rejected.ejs',
      schemaPath: './src/templates/offer_rejected.json',
    },
    application_approved: {
      templatePath: './src/templates/application_approved.ejs',
      schemaPath: './src/templates/application_approved.json',
    },
    application_rejected: {
      templatePath: './src/templates/application_rejected.ejs',
      schemaPath: './src/templates/application_rejected.json',
    },
    seller_shop_purchase: {
      templatePath: './src/templates/seller_shop_purchase.ejs',
      schemaPath: './src/templates/seller_shop_purchase.json',
    },
    buyer_item_shipped: {
      templatePath: './src/templates/buyer_item_shipped.ejs',
      schemaPath: './src/templates/buyer_item_shipped.json',
    },
    seller_shipping_reminder: {
      templatePath: './src/templates/seller_shipping_reminder.ejs',
      schemaPath: './src/templates/seller_shipping_reminder.json',
    },
    inbox_message: {
      templatePath: './src/templates/inbox_message.ejs',
      schemaPath: './src/templates/inbox_message.json',
    },
    auctions_enabled: {
      templatePath: './src/templates/auctions_enabled.ejs',
      schemaPath: './src/templates/auctions_enabled.json',
    },
    crypto_enabled: {
      templatePath: './src/templates/crypto_enabled.ejs',
      schemaPath: './src/templates/crypto_enabled.json',
    },
    buyer_payment_expired: {
      templatePath: './src/templates/buyer_payment_expired.ejs',
      schemaPath: './src/templates/buyer_payment_expired.json',
    },
    buyer_payment_failed: {
      templatePath: './src/templates/buyer_payment_failed.ejs',
      schemaPath: './src/templates/buyer_payment_failed.json',
    },
    buyer_shop_purchase: {
      templatePath: './src/templates/buyer_shop_purchase.ejs',
      schemaPath: './src/templates/buyer_shop_purchase.json',
    },
    concierge_assigned: {
      templatePath: './src/templates/concierge_assigned.ejs',
      schemaPath: './src/templates/concierge_assigned.json',
    },
    review_reminder_buyer: {
      templatePath: './src/templates/review_reminder_buyer.ejs',
      schemaPath: './src/templates/review_reminder_buyer.json',
    },
    review_reminder_seller: {
      templatePath: './src/templates/review_reminder_seller.ejs',
      schemaPath: './src/templates/review_reminder_seller.json',
    },
    watcher_price_change: {
      templatePath: './src/templates/watcher_price_change.ejs',
      schemaPath: './src/templates/watcher_price_change.json',
    },
    watcher_sold_out: {
      templatePath: './src/templates/watcher_sold_out.ejs',
      schemaPath: './src/templates/watcher_sold_out.json',
    },
    auction_outbid: {
      templatePath: './src/templates/auction_outbid.ejs',
      schemaPath: './src/templates/auction_outbid.json',
    },
    auction_closing_soon: {
      templatePath: './src/templates/auction_closing_soon.ejs',
      schemaPath: './src/templates/auction_closing_soon.json',
    },
    auction_won: {
      templatePath: './src/templates/auction_won.ejs',
      schemaPath: './src/templates/auction_won.json',
    },
    auction_lost: {
      templatePath: './src/templates/auction_lost.ejs',
      schemaPath: './src/templates/auction_lost.json',
    },
    auction_payment_failed: {
      templatePath: './src/templates/auction_payment_failed.ejs',
      schemaPath: './src/templates/auction_payment_failed.json',
    },
  },
}));
