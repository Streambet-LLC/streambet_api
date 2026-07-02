import { AnalyticsProfileSocialEntry } from '../dto/collector-analytics.dto';

/** A normalized signal a connector produces, before persistence. */
export interface NormalizedSignal {
  platform: string;
  handle: string;
  url?: string | null;
  /** Provenance — must reflect a compliant source. */
  source: 'consented' | 'ebay_api' | 'vendor';
  signalType?: 'handle' | 'profile' | 'activity';
  label?: string | null;
  data?: Record<string, unknown> | null;
  confidence?: number | null;
}

/** Per-user context handed to each connector. */
export interface ConnectorUserContext {
  userId: string;
  /** `users.socials` — one consented handle per platform. */
  publicSocials: Record<string, string> | null;
  /** `analytics_profile.socials` — admin-curated consented handles (multi). */
  analyticsSocials: AnalyticsProfileSocialEntry[];
}

/**
 * A source of external signals about a collector. Implementations MUST only
 * draw from compliant sources (consented handles, our own eBay official-API
 * data, or a licensed vendor) — never scraped/non-consented data.
 */
export interface SocialConnector {
  /** Stable id, e.g. 'consented-handles', 'ebay'. */
  readonly key: string;
  /** Platforms this connector can produce signals for. */
  readonly platforms: string[];
  /** Collect normalized signals for one user. */
  collectForUser(ctx: ConnectorUserContext): Promise<NormalizedSignal[]>;
}
