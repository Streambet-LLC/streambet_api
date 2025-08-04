import { registerAs } from '@nestjs/config';

export const queueConfig = registerAs('queue', () => ({
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT, 10),
    password: process.env.REDIS_PASSWORD,
    username: process.env.REDIS_USERNAME,
  },
  queues: {
    streamLive: {
      name: `${process.env.REDIS_KEY_PREFIX}_STREAM_LIVE`,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    },
  },
}));