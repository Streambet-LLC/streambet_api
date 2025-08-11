export interface Location {
  ip: string;
  country?: string; // ISO2 e.g. "US"
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  isVpn?: boolean;
  raw?: any;
}
