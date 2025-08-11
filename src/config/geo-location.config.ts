import { registerAs } from '@nestjs/config';

export default registerAs('geo', () => ({
  abstractKey: process.env.ABSTRACT_API_KEY,
  blockStateCode: process.env.BLOCKED_STATE_CODES,
  blockVPN: process.env.BLOCK_VPN,
  trustProxy: process.env.TRUST_PROXY,
  geoCacheTTLSeconds: process.env.GEO_CACHE_TTL_SECONDS,
}));
