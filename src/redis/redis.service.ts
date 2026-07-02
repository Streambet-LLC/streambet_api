import {
  Injectable,
  OnModuleDestroy,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private configService: ConfigService) {
    this.initRedisClient();
  }

  onModuleInit(): void {
    // Kick off the connection but DON'T block or crash boot on failure. The
    // client has a retryStrategy + an 'error' listener, so it reconnects in
    // the background when Redis comes back. Rethrowing here previously took
    // the whole API down (unhandled rejection) on any Redis hiccup.
    this.client
      .connect()
      .then(() => this.logger.log('Redis connected'))
      .catch((err: any) =>
        this.logger.error(
          `Initial Redis connect failed: ${err?.message} — retrying in background.`,
        ),
      );
  }

  /**
   * Initialize the Redis client using env configs
   */
  private initRedisClient() {
    const host = this.configService.get<string>('redis.host');
    const port = this.configService.get<number>('redis.port');
    const password = this.configService.get<string>('redis.password');
    const db = this.configService.get<number>('redis.db');
    const keyPrefix = this.configService.get<string>('redis.keyPrefix') || '';
    const username =
      this.configService.get<string>('redis.username') || undefined;
    const tlsEnabled = this.configService.get<boolean>('redis.tls') === true;

    this.client = new Redis({
      host,
      port,
      username,
      password: password || undefined,
      db,
      keyPrefix,
      lazyConnect: true,
      tls: tlsEnabled ? {} : undefined,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableReadyCheck: false,
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to Redis');
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`, err.stack);
    });
  }

  /**
   * Get Redis client
   */
  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client is not initialized');
    }
    return this.client;
  }

  /**
   * Gracefully close the connection on module destroy
   */

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      if (this.client.status !== 'end') {
        await this.client.quit();
      }
    } catch (err: any) {
      this.logger.warn(
        `Error during Redis quit: ${err?.message}. Forcing disconnect.`,
      );
      this.client.disconnect(false);
    } finally {
      this.client.removeAllListeners();
      this.logger.log('Redis connection closed');
    }
  }

  // EXAMPLE: Add more abstracted methods if needed
  async set(key: string, value: string, ttl?: number) {
    if (typeof ttl === 'number' && ttl > 0) {
      await this.client.set(key, value, 'EX', ttl);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async delete(key: string): Promise<number> {
    return this.client.del(key);
  }
}
