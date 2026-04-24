export type EbayAccessMode = 'admin-only' | 'everyone';

export const ebayFeatureConfig = {
  enabled: true,
  accessMode: 'admin-only' as EbayAccessMode,
  timeoutMs: 20000,
  cacheTtlSeconds: 90,
  rateLimit: {
    perUserShortWindowPoints: 1,
    perUserShortWindowSeconds: 3,
    perUserLongWindowPoints: 10,
    perUserLongWindowSeconds: 300,
    globalWindowPoints: 60,
    globalWindowSeconds: 300,
    retryAfterSecondsDefault: 3,
  },
} as const;
