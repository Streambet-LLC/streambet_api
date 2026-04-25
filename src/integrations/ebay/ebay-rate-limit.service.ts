import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';

type ConsumeResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

@Injectable()
export class EbayRateLimitService {
  private readonly logger = new Logger(EbayRateLimitService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  private getDefaultRetryAfterSeconds(): number {
    return this.configService.get<number>('ebay.retryAfterSecondsDefault') ?? 3;
  }

  private async consumeWindow(
    key: string,
    maxPoints: number,
    windowSeconds: number,
  ): Promise<ConsumeResult> {
    const client = this.redisService.getClient();

    const multiResult = await client.multi().incr(key).ttl(key).exec();
    const count = Number(multiResult?.[0]?.[1] ?? 0);
    let ttl = Number(multiResult?.[1]?.[1] ?? -1);

    if (count === 1 || ttl === -1) {
      await client.expire(key, windowSeconds);
      ttl = windowSeconds;
    }

    if (count > maxPoints) {
      return {
        allowed: false,
        retryAfterSeconds: ttl > 0 ? ttl : this.getDefaultRetryAfterSeconds(),
      };
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  }

  async checkAndConsume(userId: string): Promise<ConsumeResult> {
    const userShortPoints =
      this.configService.get<number>('ebay.perUserShortWindowPoints') ?? 1;
    const userShortSeconds =
      this.configService.get<number>('ebay.perUserShortWindowSeconds') ?? 3;
    const userLongPoints =
      this.configService.get<number>('ebay.perUserLongWindowPoints') ?? 10;
    const userLongSeconds =
      this.configService.get<number>('ebay.perUserLongWindowSeconds') ?? 300;
    const globalPoints =
      this.configService.get<number>('ebay.globalWindowPoints') ?? 60;
    const globalSeconds =
      this.configService.get<number>('ebay.globalWindowSeconds') ?? 300;

    const userKeyBase = `ebay:search:user:${userId}`;

    try {
      const userShort = await this.consumeWindow(
        `${userKeyBase}:short`,
        userShortPoints,
        userShortSeconds,
      );
      if (!userShort.allowed) return userShort;

      const userLong = await this.consumeWindow(
        `${userKeyBase}:long`,
        userLongPoints,
        userLongSeconds,
      );
      if (!userLong.allowed) return userLong;

      const global = await this.consumeWindow(
        'ebay:search:global',
        globalPoints,
        globalSeconds,
      );
      if (!global.allowed) return global;

      return { allowed: true, retryAfterSeconds: 0 };
    } catch (error) {
      this.logger.error(
        'Rate limiter check failed; failing closed',
        error as Error,
      );
      return {
        allowed: false,
        retryAfterSeconds: this.getDefaultRetryAfterSeconds(),
      };
    }
  }
}
