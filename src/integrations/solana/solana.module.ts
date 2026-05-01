import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoPaymentsService } from './crypto-payments.service';
import { CryptoOrderService } from './crypto-order.service';
import {
  CryptoPaymentsController,
  AdminCryptoPaymentsController,
} from './crypto-payments.controller';
import { PrizeOrder } from '../../prize/entities/prize-order.entity';
import { PrizeConfiguration } from '../../prize/entities/prize-configuration.entity';
import { PrizeRedemption } from '../../prize/entities/prize-redemption.entity';
import { ShopSettings } from '../../prize/entities/shop-settings.entity';
import { User } from '../../users/entities/user.entity';
import { QueueModule } from '../../queue/queue.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PrizeOrder,
      PrizeConfiguration,
      PrizeRedemption,
      ShopSettings,
      User,
    ]),
    QueueModule,
  ],
  providers: [CryptoPaymentsService, CryptoOrderService],
  controllers: [CryptoPaymentsController, AdminCryptoPaymentsController],
  exports: [CryptoPaymentsService, CryptoOrderService],
})
export class SolanaModule {}
