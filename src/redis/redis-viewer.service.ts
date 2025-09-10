// redis-viewer.repository.ts
import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisService } from '../redis/redis.service';

const keyFor = (streamId: string) => `stream:${streamId}:viewers`;
const DEFAULT_TTL_SECONDS = 60 * 10; // 10 minutes

const LUA_ADD = `
-- KEYS[1]=hash, ARGV[1]=userId, ARGV[2]=ttlSeconds
redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return redis.call('HLEN', KEYS[1])
`;

const LUA_REMOVE = `
-- KEYS[1]=hash, ARGV[1]=userId
local c = redis.call('HINCRBY', KEYS[1], ARGV[1], -1)
if c <= 0 then
  redis.call('HDEL', KEYS[1], ARGV[1])
end
local hlen = redis.call('HLEN', KEYS[1])
if hlen == 0 then
  redis.call('DEL', KEYS[1])
end
return hlen
`;

@Injectable()
export class RedisViewerService {
  private readonly logger = new Logger(RedisViewerService.name);
  private readonly client: Redis;
  private shas: { add?: string; remove?: string } = {};

  constructor(private readonly redis: RedisService) {
    this.client = this.redis.getClient();
  }

  private async loadScript(lua: string): Promise<string> {
    return (await this.client.script('LOAD', lua)) as string;
  }
  private isNoScriptError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      String((err as any).message ?? err).includes('NOSCRIPT')
    );
  }

  private async evalshaOrEval(
    lua: string,
    sha: string,
    numKeys: number,
    ...args: (string | number)[]
  ) {
    try {
      return await this.client.evalsha(sha, numKeys, ...args);
    } catch (err) {
      if (this.isNoScriptError(err)) {
        // Redis restarted or SCRIPT FLUSH: degrade to EVAL
        return this.client.eval(lua, numKeys, ...args);
      }
      throw err;
    }
  }

  private async ensureScripts() {
    if (!this.shas.add) {
      this.shas.add = await this.loadScript(LUA_ADD);
    }
    if (!this.shas.remove) {
      this.shas.remove = await this.loadScript(LUA_REMOVE);
    }
  }

  /** Increment per-user connection count; returns unique viewer count. */
  async addConnection(
    streamId: string,
    userId: string,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<number> {
    await this.ensureScripts();
    const res = await this.evalshaOrEval(
      LUA_ADD,
      this.shas.add!,
      1,
      keyFor(streamId),
      userId,
      String(ttlSeconds),
    );

    const unique = Number(res ?? 0);
    return Number.isFinite(unique) ? unique : 0;
  }

  /** Decrement, delete field if 0; returns unique viewer count. */
  async removeConnection(streamId: string, userId: string): Promise<number> {
    await this.ensureScripts();
    const res = await this.evalshaOrEval(
      LUA_REMOVE,
      this.shas.remove!,
      1,
      keyFor(streamId),
      userId,
    );

    const unique = Number(res ?? 0);
    return Number.isFinite(unique) ? unique : 0;
  }

  /** Current unique viewers (users with field present). */
  async getUniqueViewerCount(streamId: string): Promise<number> {
    const n = await this.client.hlen(keyFor(streamId));
    return Number(n ?? 0);
  }

  /** Optional: refresh TTL to keep active streams alive. */
  async refreshTtl(streamId: string, ttlSeconds = DEFAULT_TTL_SECONDS) {
    await this.client.expire(keyFor(streamId), ttlSeconds);
  }

  /** Optional hard reset. */
  async clearStream(streamId: string) {
    await this.client.del(keyFor(streamId));
  }
}
