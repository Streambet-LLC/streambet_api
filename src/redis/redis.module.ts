import { Module, Global } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('redis.host');
        const port = Number(config.get<string>('redis.port'));
        const password = config.get<string>('redis.password');
        const username = config.get<string>('redis.username');
        const keyPrefix = config.get<string>('redis.keyPrefix');
        const useTls = config.get<string>('redis.tls', 'false') === 'true';

        const connectionOptions: RedisOptions = {
          host,
          port,
          password: password || undefined,
          username: username || undefined,
          keyPrefix,
          tls: useTls ? {} : undefined,
          lazyConnect: false,
        };

        const client = new Redis(connectionOptions);

        client.on('error', (err) => {
          console.error('[Redis] error:', err?.message || err);
        });

        client.on('connect', () => {
          console.log('[Redis] connected');
        });

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
