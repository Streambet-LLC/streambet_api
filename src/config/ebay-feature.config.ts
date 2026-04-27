export type EbayAccessMode = 'admin-only' | 'everyone';

export const ebayFeatureConfig = {
  enabled: true,
  accessMode: 'admin-only' as EbayAccessMode,
  timeoutMs: 20000,
  cacheTtlSeconds: 90,
} as const;
