import { registerAs } from '@nestjs/config';

export default registerAs('persona', () => ({
  apiUrl: process.env.PERSONA_API_URL || '',
  apiKey: process.env.PERSONA_API_KEY || '',
  timeoutMs: Number(process.env.PERSONA_TIMEOUT_MS || 10000),
  maxRetries: Number(process.env.PERSONA_MAX_RETRIES || 2),
  retryDelayMs: Number(process.env.PERSONA_RETRY_DELAY_MS || 300),
}));
