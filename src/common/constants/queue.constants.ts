// Queue name helper – evaluated once at load time
const prefix = process.env.REDIS_KEY_PREFIX ? `${process.env.REDIS_KEY_PREFIX}_` : '';

export const STREAM_LIVE_QUEUE = `${prefix}STREAM_LIVE`;
export const MAKE_LIVE_JOB = 'make-live';

export const EMAIL_QUEUE = `${prefix}EMAIL`;
export const SEND_EMAIL_JOB = 'send-mail';

