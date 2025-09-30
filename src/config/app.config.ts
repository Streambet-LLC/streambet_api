import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  name: process.env.APP_NAME || 'Streambet API',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:8080',
  enableApiLogging: process.env.ENABLE_API_LOGGING === 'true',
  enableDetailedLogging: process.env.ENABLE_DETAILED_LOGGING === 'true',
  environment: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  isSwaggerEnable: process.env.IS_SWAGGER_ENABLED === 'true',
  isBullmqUiEnabled: process.env.IS_BULLMQ_UI_ENABLED === 'true',
  isNewRelicEnable: process.env.NEW_RELIC_ENABLED === 'true',
}));
