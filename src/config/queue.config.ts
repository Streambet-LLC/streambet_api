import { registerAs } from '@nestjs/config';
import {
  EMAIL_QUEUE,
  BET_RESULTS_QUEUE,
} from 'src/common/constants/queue.constants';

export const queueConfig = registerAs('queue', () => ({
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
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
    email: {
      name: EMAIL_QUEUE,
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
    betResults: {
      name: BET_RESULTS_QUEUE,
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
