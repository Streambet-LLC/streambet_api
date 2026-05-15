import { Module } from '@nestjs/common';
import { EbayController } from './ebay.controller';
import { EbayService } from './ebay.service';
import { EbayKeyManagerService } from './ebay-key-manager.service';

@Module({
  controllers: [EbayController],
  providers: [EbayService, EbayKeyManagerService],
  exports: [EbayService, EbayKeyManagerService],
})
export class EbayModule {}
