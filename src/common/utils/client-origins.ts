import { ConfigService } from '@nestjs/config';

/**
 * Origins of our own web front ends: the main site (`CLIENT_URL` /
 * `APP_HOST_URL`) and, when it has its own domain, the Hermes Auctions site
 * (`HERMES_WEB_URL`). Only these may receive auth tokens or Stripe returns.
 */
export function clientOrigins(config: ConfigService): string[] {
  const urls = [
    config.get<string>('CLIENT_URL'),
    config.get<string>('APP_HOST_URL'),
    config.get<string>('HERMES_WEB_URL'),
  ];
  const origins = new Set<string>();
  for (const u of urls) {
    const origin = originOf(u);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

/** `https://host[:port]` for a URL, or null when it isn't one. */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * True for one of our front-end origins. `allowAnyLocalhost` also accepts
 * any `http://localhost:*` (fine for Stripe returns; never for auth tokens,
 * where localhost counts only if it's a configured origin, as in dev).
 */
export function isClientOrigin(
  config: ConfigService,
  url: string,
  { allowAnyLocalhost = false }: { allowAnyLocalhost?: boolean } = {},
): boolean {
  const origin = originOf(url);
  if (!origin) return false;
  return (
    clientOrigins(config).includes(origin) ||
    (allowAnyLocalhost && /^http:\/\/localhost(:\d+)?$/.test(origin))
  );
}
