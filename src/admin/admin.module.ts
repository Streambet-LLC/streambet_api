import { forwardRef, Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CollectorAnalyticsService } from './collector-analytics.service';
import { SellerInventoryService } from './seller-inventory.service';
import { GoogleSheetsService } from './google-sheets.service';
import { SellerInventoryUpload } from './entities/seller-inventory-upload.entity';
import { SellerInventoryItem } from './entities/seller-inventory-item.entity';
import { ExternalSignal } from './entities/external-signal.entity';
import { DiscoveredLead } from './entities/discovered-lead.entity';
import { CardForecast } from './entities/card-forecast.entity';
import { CardMarketSnapshot } from './entities/card-market-snapshot.entity';
import { DeepResearchJob } from './entities/deep-research-job.entity';
import { ForecastService } from './forecast.service';
import { InsightsService } from './insights.service';
import { DeepResearchService } from './deep-research.service';
import { CardProfileService } from './card-profile.service';
import { EbayMarketSource } from './card-market/ebay-market.source';
import { WebResearchMarketSource } from './card-market/web-research-market.source';
import { AcquisitionService } from './acquisition/acquisition.service';
import { ConsentedHandlesConnector } from './acquisition/consented-handles.connector';
import { MarketService } from './market.service';
import { RedditModule } from '../integrations/reddit/reddit.module';
import { BlueskyModule } from '../integrations/bluesky/bluesky.module';
import { YoutubeModule } from '../integrations/youtube/youtube.module';
import { GoogleSearchModule } from '../integrations/google-search/google-search.module';
import { TwitchModule } from '../integrations/twitch/twitch.module';
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
      ExternalSignal,
      DiscoveredLead,
      CardForecast,
      CardMarketSnapshot,
      DeepResearchJob,
    ]),
    BettingModule,
    WalletsModule,
    StreamModule,
    CreatorModule,
    SubscriptionModule,
    PromoCodeModule,
    QueueModule,
    RedditModule,
    BlueskyModule,
    YoutubeModule,
    GoogleSearchModule,
    TwitchModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminService,
    CollectorAnalyticsService,
    SellerInventoryService,
    GoogleSheetsService,
    AcquisitionService,
    ConsentedHandlesConnector,
    MarketService,
    ForecastService,
    InsightsService,
    DeepResearchService,
    CardProfileService,
    EbayMarketSource,
    WebResearchMarketSource,
  ],
})
export class AdminModule {}
