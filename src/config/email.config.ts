import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  SMTP_USER: process.env.AWS_SMTP_USER,
  SMTP_PASSWORD: process.env.AWS_SMTP_PASSWORD,
  SMTP_PORT: process.env.AWS_SMTP_PORT,
  SMTP_HOST: process.env.AWS_SMTP_HOST,
  SMTP_SECURE: true,
  FROM_EMAIL: process.env.AWS_EMAIL_FROM,
  SMTP_REGION: process.env.AWS_SMTP_REGION,
  APPLICATION_HOST: process.env.APPLICATION_HOST || '',
  HOST_URL: process.env.APP_HOST_URL || '',
  HOSTED: process.env.HOSTED,
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
  },
}));
