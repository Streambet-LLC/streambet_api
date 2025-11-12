import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  // Determine if we should use MailHog based on NODE_ENV
  USE_MAILHOG: process.env.NODE_ENV === 'development',
  
  // MailHog Configuration (Development)
  MAILHOG_HOST: process.env.MAILHOG_HOST || 'localhost',
  MAILHOG_PORT: parseInt(process.env.MAILHOG_PORT || '1025', 10),
  
  // AWS SES Configuration (Production/Staging)
  SMTP_USER: process.env.AWS_SMTP_USER,
  SMTP_PASSWORD: process.env.AWS_SMTP_PASSWORD,
  SMTP_PORT: process.env.AWS_SMTP_PORT,
  SMTP_HOST: process.env.AWS_SMTP_HOST,
  SMTP_SECURE: true,
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
  },
}));
