import { registerAs } from '@nestjs/config';

export default registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL || '60', 10), // seconds
  limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10), // max requests per TTL
  ttls: {
    eightHours: 28800000,
    fullDay: 86400,
    fourHours: 14400000,
    fiveMinutes: 300000,
    oneHour: 3600000,
    tenSec: 10000,
  },
}));
