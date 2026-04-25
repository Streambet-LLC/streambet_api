import { registerAs } from '@nestjs/config';

export default registerAs('psa', () => ({
  apiBaseUrl:
    process.env.PSA_API_BASE_URL || 'https://api.psacard.com/publicapi',
  accessToken: process.env.PSA_ACCESS_TOKEN || '',
  timeoutMs: Number(process.env.PSA_TIMEOUT_MS || 10000),
  cacheTtlSeconds: Number(process.env.PSA_CACHE_TTL_SECONDS || 86400),
}));
