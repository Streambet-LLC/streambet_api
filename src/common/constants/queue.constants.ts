import { config as dotenvConfig } from 'dotenv';

dotenvConfig(); // Load environment variables before constants are resolved

const prefix = process.env.REDIS_KEY_PREFIX ? `${process.env.REDIS_KEY_PREFIX}_` : '';

export const STREAM_LIVE_QUEUE = `${prefix}STREAM_LIVE`;
export const MAKE_LIVE_JOB = 'make-live';

