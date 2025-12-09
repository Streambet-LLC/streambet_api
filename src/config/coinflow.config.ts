import { registerAs } from '@nestjs/config';

export default registerAs('coinflow', () => ({
  apiUrl: process.env.COINFLOW_API_URL || '',
  apiKey: process.env.COINFLOW_API_KEY || '',
  defaultToken: process.env.COINFLOW_DEFAULT_TOKEN || '',
  merchantId: process.env.COINFLOW_MERCHANT_ID || '',
  blockchain: process.env.COINFLOW_BLOCKCHAIN || '',
  timeoutMs: Number(process.env.COINFLOW_TIMEOUT_MS || 10000),
  maxRetries: Number(process.env.COINFLOW_MAX_RETRIES || 2),
  retryDelayMs: Number(process.env.COINFLOW_RETRY_DELAY_MS || 300),
  webhookSecret: process.env.COINFLOW_WEBHOOK_SECRET || '',
  webhookEnv: (process.env.COINFLOW_WEBHOOK_ENV || '').toLowerCase(),
  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || '',
    webhookSecret: process.env.N8N_WEBHOOK_SECRET || '',
    enabled: process.env.N8N_ENABLED === 'true',
    retries: Number(process.env.N8N_RETRIES || 3),
    retryDelayMs: Number(process.env.N8N_RETRY_DELAY_MS || 1000),
    timeoutMs: Number(process.env.N8N_TIMEOUT_MS || 5000),
  },
}));


