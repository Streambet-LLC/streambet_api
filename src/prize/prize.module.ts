import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrizeConfiguration } from './entities/prize-configuration.entity';
import { PrizeRedemption } from './entities/prize-redemption.entity';
import { PrizeOrder } from './entities/prize-order.entity';
import { ItemConfigurationImage } from './entities/item-configuration-image.entity';
import { ShopSettings } from './entities/shop-settings.entity';
import { PrizeItemView } from './entities/prize-item-view.entity';
import { PrizeItemWatcher } from './entities/prize-item-watcher.entity';
import { Auction } from './entities/auction.entity';
import { AuctionBid } from './entities/auction-bid.entity';
import { User } from '../users/entities/user.entity';
import { PrizeService } from './prize.service';
import { PrizeEngagementService } from './prize-engagement.service';
import {
  PrizeController,
  AdminPrizeController,
  SellerPrizeController,
} from './prize.controller';
import { WalletsModule } from '../wallets/wallets.module';
import { EmailsModule } from '../emails/email.module';
import { PromoCodeModule } from '../promo-code/promo-code.module';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PrizeConfiguration,
      ItemConfigurationImage,
      PrizeRedemption,
      PrizeOrder,
      ShopSettings,
      PrizeItemView,
      PrizeItemWatcher,
      Auction,
      AuctionBid,
      User,
    ]),
    forwardRef(() => WalletsModule),
    EmailsModule,
    PromoCodeModule,
    InboxModule,
  ],
  controllers: [PrizeController, AdminPrizeController, SellerPrizeController],
  providers: [PrizeService, PrizeEngagementService],
  exports: [PrizeService, PrizeEngagementService],
})
export class PrizeModule {}
