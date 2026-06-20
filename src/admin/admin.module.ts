import { forwardRef, Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CollectorAnalyticsService } from './collector-analytics.service';
import { SellerInventoryService } from './seller-inventory.service';
import { GoogleSheetsService } from './google-sheets.service';
import { SellerInventoryUpload } from './entities/seller-inventory-upload.entity';
import { SellerInventoryItem } from './entities/seller-inventory-item.entity';
import { UsersModule } from '../users/users.module';
import { BettingModule } from '../betting/betting.module';
import { WalletsModule } from '../wallets/wallets.module';
import { StreamModule } from 'src/stream/stream.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { CreatorModule } from 'src/creator/creator.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { PromoCodeModule } from 'src/promo-code/promo-code.module';
import { QueueModule } from 'src/queue/queue.module';
import { PrizeOrder } from 'src/prize/entities/prize-order.entity';
import { PrizeConfiguration } from 'src/prize/entities/prize-configuration.entity';
import { ConciergeRequest } from 'src/concierge/entities/concierge-request.entity';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    TypeOrmModule.forFeature([
      User,
      PrizeOrder,
      PrizeConfiguration,
      ConciergeRequest,
      SellerInventoryUpload,
      SellerInventoryItem,
    ]),
    BettingModule,
    WalletsModule,
    StreamModule,
    CreatorModule,
    SubscriptionModule,
    PromoCodeModule,
    QueueModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminService,
    CollectorAnalyticsService,
    SellerInventoryService,
    GoogleSheetsService,
  ],
})
export class AdminModule {}
