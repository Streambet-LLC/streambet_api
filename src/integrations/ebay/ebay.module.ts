import { Module } from '@nestjs/common';
import { EbayController } from './ebay.controller';
import { EbayService } from './ebay.service';
import { EbayRateLimitService } from './ebay-rate-limit.service';

@Module({
  controllers: [EbayController],
  providers: [EbayService, EbayRateLimitService],
  exports: [EbayService, EbayRateLimitService],
})
export class EbayModule {}
