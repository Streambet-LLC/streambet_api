import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisViewerService } from './redis-viewer.service';

@Global()
@Module({
  providers: [RedisService, RedisViewerService],
  exports: [RedisService, RedisViewerService],
})
export class RedisModule {}
