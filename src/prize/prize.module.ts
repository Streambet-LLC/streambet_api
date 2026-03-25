import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrizeConfiguration } from './entities/prize-configuration.entity';
import { PrizeRedemption } from './entities/prize-redemption.entity';
import { PrizeOrder } from './entities/prize-order.entity';
import { ItemConfigurationImage } from './entities/item-configuration-image.entity';
import { ShopSettings } from './entities/shop-settings.entity';
import { User } from '../users/entities/user.entity';
import { PrizeService } from './prize.service';
import {
  PrizeController,
  AdminPrizeController,
  SellerPrizeController,
} from './prize.controller';
import { WalletsModule } from '../wallets/wallets.module';
import { EmailsModule } from '../emails/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PrizeConfiguration,
      ItemConfigurationImage,
      PrizeRedemption,
      PrizeOrder,
      ShopSettings,
      User,
    ]),
    forwardRef(() => WalletsModule),
    EmailsModule,
  ],
  controllers: [PrizeController, AdminPrizeController, SellerPrizeController],
  providers: [PrizeService],
  exports: [PrizeService],
})
export class PrizeModule {}
