import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import axios from 'axios';
import { Location } from 'src/interface/geo-fencing.interface';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GeoFencingService {
  private readonly logger = new Logger(GeoFencingService.name);
  private readonly apiKey: string;
  private readonly fullDay: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('geo.abstractKey');
    this.fullDay =
      this.configService.get<number>('throttle.ttls.fullDay') ?? 86400; // default 1 day in seconds
  }

  private cacheKey(ip: string) {
    return `geo:${ip}`;
  }

  private normalizeIp(ip: string) {
    return ip?.replace(/^::ffff:/, '') ?? '';
  }

  async lookup(ip: string): Promise<Location | null> {
    if (!ip) return null;
    ip = this.normalizeIp(ip);
    if (!ip) return null;

    const key = this.cacheKey(ip);
    this.logger.debug(`Checking cache for ${key}`);

    try {
      const cached = await this.cache.get<Location>(key);
      if (cached) {
        this.logger.debug(`Cache hit: ${JSON.stringify(cached)}`);
        return cached;
      }
    } catch (e) {
      this.logger.warn(`Cache GET failed: ${String(e)}`);
    }

    if (!this.apiKey) {
      this.logger.error('ABSTRACT_API_KEY not set');
      return null;
    }

    const url = `https://ipgeolocation.abstractapi.com/v1/?api_key=${encodeURIComponent(
      this.apiKey,
    )}&ip_address=${encodeURIComponent(ip)}`;

    try {
      const { data } = await axios.get(url, { timeout: 3500 });
      const loc: Location = {
        ip,
        country: data?.country_code,
        region: data?.region,
        city: data?.city,
        latitude: data?.latitude ? Number(data.latitude) : undefined,
        longitude: data?.longitude ? Number(data.longitude) : undefined,
        timezone: data?.timezone?.name,
        isVpn: data?.security?.is_vpn ?? false,
        raw: data,
      };

      try {
      await this.cache.set(key, JSON.stringify(loc), this.fullDay);
        this.logger.debug(`Cache set: ${key}`);
      } catch (e) {
        this.logger.warn(`Cache SET failed: ${String(e)}`);
      }

      return loc;
    } catch (err) {
      this.logger.warn(`AbstractAPI request failed: ${String(err)}`);
      return null;
    }
  }
}
