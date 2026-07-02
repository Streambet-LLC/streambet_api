import { Module } from '@nestjs/common';
import { BlueskyService } from './bluesky.service';

@Module({
  providers: [BlueskyService],
  exports: [BlueskyService],
})
export class BlueskyModule {}
