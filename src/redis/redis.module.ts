import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisViewerService } from './redis-viewer.service';
import { BettingSummaryService } from './betting-summary.service';

@Global()
@Module({
  providers: [RedisService, RedisViewerService, BettingSummaryService],
  exports: [RedisService, RedisViewerService, BettingSummaryService],
})
export class RedisModule {}
