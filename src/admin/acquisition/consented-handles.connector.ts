import { Injectable } from '@nestjs/common';
import {
  ConnectorUserContext,
  NormalizedSignal,
  SocialConnector,
} from './social-connector.interface';

/** Map a platform + handle to a public profile URL where the pattern is known. */
const PROFILE_URL: Record<string, (h: string) => string> = {
  instagram: (h) => `https://instagram.com/${h}`,
  twitter: (h) => `https://x.com/${h}`,
  x: (h) => `https://x.com/${h}`,
  tiktok: (h) => `https://tiktok.com/@${h}`,
  youtube: (h) => `https://youtube.com/@${h}`,
  facebook: (h) => `https://facebook.com/${h}`,
  twitch: (h) => `https://twitch.tv/${h}`,
  ebay: (h) => `https://www.ebay.com/usr/${h}`,
};

const cleanHandle = (raw: string): string =>
  raw
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/\/+$/, '')
    .replace(/^@/, '');

const toUrl = (platform: string, value: string): string | null => {
  if (/^https?:\/\//i.test(value)) return value;
  const fn = PROFILE_URL[platform.toLowerCase()];
  return fn ? fn(cleanHandle(value)) : null;
};

/**
 * Emits one signal per social handle a user/seller has consented to share —
 * from `users.socials` (public profile) and `analytics_profile.socials`
 * (admin-curated). Pure consented data; makes no outbound network calls, so
 * it's the safe baseline substrate for reconciliation + list building.
 */
@Injectable()
export class ConsentedHandlesConnector implements SocialConnector {
  readonly key = 'consented-handles';
  readonly platforms = Object.keys(PROFILE_URL);

  collectForUser(ctx: ConnectorUserContext): Promise<NormalizedSignal[]> {
    const out: NormalizedSignal[] = [];
    const seen = new Set<string>();

    const add = (platform: string, value: string, label?: string | null) => {
      const handle = cleanHandle(value);
      if (!platform || !handle) return;
      const key = `${platform.toLowerCase()}::${handle.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        platform: platform.toLowerCase(),
        handle,
        url: toUrl(platform, value),
        source: 'consented',
        signalType: 'handle',
        label: label ?? null,
      });
    };

    // Public socials map (one per platform).
    for (const [platform, value] of Object.entries(ctx.publicSocials ?? {})) {
      if (typeof value === 'string' && value.trim()) add(platform, value);
    }
    // Admin-curated analytics socials (multiple per platform, with labels).
    for (const entry of ctx.analyticsSocials ?? []) {
      if (entry?.value?.trim()) add(entry.platform, entry.value, entry.label);
    }

    return Promise.resolve(out);
  }
}
