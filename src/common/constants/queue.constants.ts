// Queue name helper – evaluated once at load time
const prefix = process.env.REDIS_KEY_PREFIX ? `${process.env.REDIS_KEY_PREFIX}_` : '';

export const STREAM_LIVE_QUEUE = `${prefix}STREAM_LIVE`;
export const MAKE_LIVE_JOB = 'make-live';

export const EMAIL_QUEUE = `${prefix}EMAIL`;
export const SEND_EMAIL_JOB = 'send-mail';

export const COINFLOW_WEBHOOK_QUEUE = `${prefix}COINFLOW_WEBHOOK`;
export const QUEUE_COINFLOW_WEBHOOK = 'queue-coinflow-webhook';

export const BET_RESULTS_QUEUE = `${prefix}BET_RESULTS`;
export const TRACK_BET_RESULT_JOB = 'track-bet-result';
export const SEND_STREAM_SUMMARY_JOB = 'send-stream-summary';

// Redis key pattern for tracking bet result job IDs by stream
export const STREAM_BET_JOBS_KEY = (streamId: string) => `${prefix}stream_bet_jobs:${streamId}`;
