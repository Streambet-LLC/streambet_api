import { registerAs } from '@nestjs/config';

export default registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL || '60', 10), // seconds
  limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10), // max requests per TTL
}));
