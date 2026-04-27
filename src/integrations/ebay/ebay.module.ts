import { Module } from '@nestjs/common';
import { EbayController } from './ebay.controller';
import { EbayService } from './ebay.service';

@Module({
  controllers: [EbayController],
  providers: [EbayService],
  exports: [EbayService],
})
export class EbayModule {}
