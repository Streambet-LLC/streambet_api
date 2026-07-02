import { Module } from '@nestjs/common';
import { GoogleSearchService } from './google-search.service';

@Module({
  providers: [GoogleSearchService],
  exports: [GoogleSearchService],
})
export class GoogleSearchModule {}
