import { registerAs } from '@nestjs/config';

/**
 * Mixpanel server-side config. `token` is the project token (used for event
 * ingestion). `apiSecret` is the project API Secret — only needed for the
 * export API; kept here so it never leaks into client code. Both are
 * optional: when `token` is empty the MixpanelService runs as a no-op so the
 * app boots fine in environments where analytics isn't configured.
 */
export default registerAs('mixpanel', () => ({
  token: process.env.MIXPANEL_TOKEN || '',
  apiSecret: process.env.MIXPANEL_API_SECRET || '',
  // Tags every event so dev/staging traffic can be filtered out of prod
  // dashboards. Falls back to NODE_ENV when not explicitly set.
  environment:
    process.env.MIXPANEL_ENV || process.env.NODE_ENV || 'development',
}));
