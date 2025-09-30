export enum StreamList {
  StreamCreated = 'stream_created',
  StreamUpdated = 'stream_updated',
  StreamDeleted = 'stream_deleted',
  StreamEnded = 'stream_ended',
  StreamBetUpdated = 'stream_bet_updated',
}

export enum StreamStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  ENDED = 'ended',
  CANCELLED = 'cancelled',
  DELETED = 'deleted',
  ACTIVE = 'active',
}
