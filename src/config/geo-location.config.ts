import { registerAs } from '@nestjs/config';

export default registerAs('geo', () => ({
  abstractKey: process.env.ABSTRACT_API_KEY,
 blockedRegion: process.env.BLOCKED_REGION,
  blockVPN: process.env.BLOCK_VPN,
  trustProxy: process.env.TRUST_PROXY,
}));
