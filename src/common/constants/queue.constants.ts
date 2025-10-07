// Queue name helper – evaluated once at load time
const prefix = process.env.REDIS_KEY_PREFIX ? `${process.env.REDIS_KEY_PREFIX}_` : '';

export const STREAM_LIVE_QUEUE = `${prefix}STREAM_LIVE`;
export const MAKE_LIVE_JOB = 'make-live';

export const EMAIL_QUEUE = `${prefix}EMAIL`;
export const SEND_EMAIL_JOB = 'send-mail';

export const COINFLOW_WEBHOOK_QUEUE = `${prefix}COINFLOW_WEBHOOK`;
export const QUEUE_COINFLOW_WEBHOOK = 'queue-coinflow-webhook';
