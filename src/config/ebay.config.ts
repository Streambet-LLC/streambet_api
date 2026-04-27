import { registerAs } from '@nestjs/config';
import { ebayFeatureConfig } from './ebay-feature.config';

export default registerAs('ebay', () => ({
  enabled: ebayFeatureConfig.enabled,
  accessMode: ebayFeatureConfig.accessMode,
  clientId: process.env.EBAY_CLIENT_ID || '',
  clientSecret: process.env.EBAY_CLIENT_SECRET || '',
  marketplaceId: process.env.EBAY_MARKETPLACE_ID || 'EBAY_US',
  timeoutMs: ebayFeatureConfig.timeoutMs,
  cacheTtlSeconds: ebayFeatureConfig.cacheTtlSeconds,
}));
