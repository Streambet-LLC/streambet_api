import { Module } from '@nestjs/common';
import { EbayAccountDeletionController } from './ebay-account-deletion.controller';
import { EbayService } from './ebay.service';
import { EbayKeyManagerService } from './ebay-key-manager.service';

@Module({
  controllers: [EbayAccountDeletionController],
  providers: [EbayService, EbayKeyManagerService],
  exports: [EbayService, EbayKeyManagerService],
})
export class EbayModule {}
