import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Location } from 'src/interface/geo-fencing.interface';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service'; // adjust path

@Injectable()
/**
 * Service to perform IP-based geo-location lookups and cache results.
 *
 * Features:
 * - Normalize IP addresses (removes IPv6 prefix if present)
 * - Checks Redis cache before making external API calls
 * - Fetches location details from AbstractAPI if not cached
 * - Caches successful lookups in Redis for 1 day by default (configurable)
 * - Includes VPN/proxy detection
 */
export class GeoFencingService {
  private readonly logger = new Logger(GeoFencingService.name);
  private readonly apiKey: string; // AbstractAPI key from config
  private readonly fullDay: number; // Cache TTL in seconds

  constructor(
    private readonly redisService: RedisService, // Redis for caching IP lookups
    private readonly configService: ConfigService, // App configuration access
  ) {
    this.apiKey = this.configService.get<string>('geo.abstractKey'); // AbstractAPI key
    this.fullDay =
      this.configService.get<number>('throttle.ttls.fullDay') ?? 86400; // default TTL 1 day
  }

  /** Generates a Redis cache key for a given IP */
  private cacheKey(ip: string) {
    return `geo:${ip}`;
  }

  /** Normalize IP by removing IPv6 prefix "::ffff:" if present */
  private normalizeIp(ip: string) {
    return ip?.replace(/^::ffff:/, '') ?? '';
  }

  /**
   * Lookup geographic information for a given IP.
   * 1. Normalize the IP.
   * 2. Check Redis cache first.
   * 3. If not cached, call AbstractAPI.
   * 4. Cache the result in Redis.
   *
   * @param ip - IP address to lookup
   * @returns Location object or null if lookup fails
   */
  async lookup(ip: string): Promise<Location | null> {
    if (!ip) return null;

    ip = this.normalizeIp(ip); // Normalize IPv4-mapped IPv6 addresses
    if (!ip) return null;

    const key = this.cacheKey(ip);
    this.logger.debug(`Checking Redis for ${key}`);

    // --- Check Redis cache ---
    try {
      const cached = await this.redisService.get(key);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Location;
          this.logger.debug(
            `Cache hit: key=${key} ip=${parsed?.ip} country=${parsed?.region ?? ''}`,
          );
          return parsed;
        } catch (parseErr) {
          this.logger.warn(
            `Cache parse failed for ${key}; purging. err=${String(parseErr)}`,
          );
          try {
            await this.redisService.delete?.(key);
          } catch (delErr) {
            this.logger.warn(
              `Failed to delete corrupted cache key ${key}: ${String(delErr)}`,
            );
          }
        }
      }
    } catch (e) {
      this.logger.warn(`Redis GET failed: ${String(e)}`);
    }

    // --- Abort if API key not set ---
    if (!this.apiKey) {
      this.logger.error('ABSTRACT_API_KEY not set');
      return null;
    }

    // --- Call AbstractAPI for geo-location ---
    const url = `https://ipgeolocation.abstractapi.com/v1/?api_key=${encodeURIComponent(
      this.apiKey,
    )}&ip_address=${encodeURIComponent(ip)}`;

    try {
      const { data } = await axios.get(url, { timeout: 3500 });

      // Map API response to Location object
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

      // --- Cache the result in Redis ---
      try {
        await this.redisService.set(key, JSON.stringify(loc), this.fullDay);
        this.logger.debug(`Cache set: ${key}`);
      } catch (e) {
        this.logger.warn(`Redis SET failed: ${String(e)}`);
      }

      return loc;
    } catch (err) {
      this.logger.warn(`AbstractAPI request failed: ${String(err)}`);
      return null;
    }
  }
}
