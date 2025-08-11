import { Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { Redis } from 'ioredis';
import { Location } from 'src/interface/geo-fencing.interface';

@Injectable()
export class GeoFencingService  {
  private readonly logger = new Logger(GeoFencingService.name);
  private readonly apiKey = process.env.ABSTRACT_API_KEY;
  private readonly ttlSeconds = Number(process.env.GEO_CACHE_TTL_SECONDS || 86400);

  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  private cacheKey(ip: string) {
    return `geo:abstract:${ip}`;
  }

  private async redisGet(key: string): Promise<string | null> {
    try { return await this.redisClient?.get?.(key) ?? null; }
    catch (e) { this.logger.warn('Redis GET failed: ' + String(e)); return null; }
  }

  private async redisSet(key: string, value: string, ttlSec: number) {
    if (!this.redisClient) return;
    // Try ioredis style then node-redis style
    try { await (this.redisClient as any).set(key, value, 'EX', ttlSec); return; }
    catch (e) { /* try next */ }
    try { await (this.redisClient as any).set(key, value, { EX: ttlSec }); return; }
    catch (e) { this.logger.warn('Redis SET failed: ' + String(e)); }
  }

  private normalizeIp(ip: string) {
    return ip?.replace(/^::ffff:/, '') ?? '';
  }

  async lookup(ip: string): Promise<Location | null> {
    if (!ip) return null;
    ip = this.normalizeIp(ip);
    if (!ip) return null;

    const key = this.cacheKey(ip);
    const cached = await this.redisGet(key);
    if (cached) {
      try { return JSON.parse(cached) as Location; }
      catch (e) { this.logger.warn('Failed parse geo cache: ' + String(e)); }
    }

    if (!this.apiKey) {
      this.logger.error('ABSTRACT_API_KEY not set');
      return null;
    }

    const url = `https://ipgeolocation.abstractapi.com/v1/?api_key=${encodeURIComponent(this.apiKey)}&ip_address=${encodeURIComponent(ip)}`;
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

      await this.redisSet(key, JSON.stringify(loc), this.ttlSeconds);
      return loc;
    } catch (err) {
      this.logger.warn('AbstractAPI request failed: ' + String(err));
      return null;
    }
  }
}
