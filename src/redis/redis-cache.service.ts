import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Injectable, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { Cache } from "cache-manager";

@Injectable()
export class RedisCacheService {
  private prefix;
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly configService: ConfigService,
  ) {
    this.prefix = this.configService.getOrThrow("app.queuePrefix", {
      infer: true,
    });
  }

  async get(key: string) {
    return await this.cache.get(`${this.prefix}_${key}`);
  }

  async set(key: string, value: unknown, ttl = 0) {
    await this.cache.set(`${this.prefix}_${key}`, value, ttl);
  }

  async del(key: string) {
    await this.cache.del(`${this.prefix}_${key}`);
  }

  async reset() {
    await this.cache.clear();
  }
}
