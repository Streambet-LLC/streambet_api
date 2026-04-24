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
  perUserShortWindowPoints: ebayFeatureConfig.rateLimit.perUserShortWindowPoints,
  perUserShortWindowSeconds: ebayFeatureConfig.rateLimit.perUserShortWindowSeconds,
  perUserLongWindowPoints: ebayFeatureConfig.rateLimit.perUserLongWindowPoints,
  perUserLongWindowSeconds: ebayFeatureConfig.rateLimit.perUserLongWindowSeconds,
  globalWindowPoints: ebayFeatureConfig.rateLimit.globalWindowPoints,
  globalWindowSeconds: ebayFeatureConfig.rateLimit.globalWindowSeconds,
  retryAfterSecondsDefault: ebayFeatureConfig.rateLimit.retryAfterSecondsDefault,
}));
