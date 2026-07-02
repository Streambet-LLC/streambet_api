import { Module } from '@nestjs/common';
import { RedditService } from './reddit.service';

@Module({
  providers: [RedditService],
  exports: [RedditService],
})
export class RedditModule {}
