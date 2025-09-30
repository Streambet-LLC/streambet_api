export interface Notification {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}
