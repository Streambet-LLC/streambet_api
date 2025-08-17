import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  // Server
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_DATABASE: Joi.string().required(),

  // JWT
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string(),

  // Refresh Token
  REFRESH_TOKEN_SECRET: Joi.string().required(),
  REFRESH_TOKEN_EXPIRES_IN: Joi.string(),

  // Google OAuth
  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_CALLBACK_URL: Joi.string().required(),

  // Stripe
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),

  // Coinflow
  COINFLOW_API_URL: Joi.string().uri().optional(),
  COINFLOW_API_KEY: Joi.string().optional(),
  COINFLOW_DEFAULT_TOKEN: Joi.string().optional(),
  COINFLOW_MERCHANT_ID: Joi.string().optional(),
  COINFLOW_BLOCKCHAIN: Joi.string().optional(),
  COINFLOW_TIMEOUT_MS: Joi.number().integer().min(1000).optional(),
  COINFLOW_MAX_RETRIES: Joi.number().integer().min(0).max(5).optional(),
  COINFLOW_RETRY_DELAY_MS: Joi.number().integer().min(0).optional(),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_USERNAME: Joi.string().optional(),
  REDIS_PASSWORD: Joi.string().optional(),
  REDIS_KEY_PREFIX: Joi.string().default('streambet:'),
});
