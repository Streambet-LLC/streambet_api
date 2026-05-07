// Queue name helper – evaluated once at load time
const prefix = process.env.REDIS_KEY_PREFIX
  ? `${process.env.REDIS_KEY_PREFIX}_`
  : '';

export const STREAM_LIVE_QUEUE = `${prefix}STREAM_LIVE`;
export const MAKE_LIVE_JOB = 'make-live';

export const EMAIL_QUEUE = `${prefix}EMAIL`;
export const SEND_EMAIL_JOB = 'send-mail';

export const COINFLOW_WEBHOOK_QUEUE = `${prefix}COINFLOW_WEBHOOK`;
export const QUEUE_COINFLOW_WEBHOOK = 'queue-coinflow-webhook';

export const AUCTION_QUEUE = `${prefix}AUCTION`;
export const AUCTION_CLOSE_JOB = 'auction-close';
export const AUCTION_CLOSING_SOON_JOB = 'auction-closing-soon';
export const AUCTION_AUTOPAY_RETRY_JOB = 'auction-autopay-retry';

export const EBAY_MIGRATION_QUEUE = `${prefix}EBAY_MIGRATION`;
export const EBAY_MIGRATE_PSA_FLAGS_JOB = 'migrate-psa-flags';
