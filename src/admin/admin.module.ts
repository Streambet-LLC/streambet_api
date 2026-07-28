import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SellerInventoryService } from './seller-inventory.service';
import { GoogleSheetsService } from './google-sheets.service';
import { SellerInventoryUpload } from './entities/seller-inventory-upload.entity';
import { SellerInventoryItem } from './entities/seller-inventory-item.entity';
import { ExternalSignal } from './entities/external-signal.entity';
import { DiscoveredLead } from './entities/discovered-lead.entity';
import { CardForecast } from './entities/card-forecast.entity';
import { CardMarketSnapshot } from './entities/card-market-snapshot.entity';
import { DeepResearchJob } from './entities/deep-research-job.entity';
import { InsightsExchange } from './entities/insights-exchange.entity';
import { MarketSnapshot } from './entities/market-snapshot.entity';
import { AnalyticsDashboard } from './entities/analytics-dashboard.entity';
import { TrackedCard } from './entities/tracked-card.entity';
import { SoldCard } from './entities/sold-card.entity';
import { CardValuationSnapshot } from './entities/card-valuation-snapshot.entity';
import { InsightsFeedback } from './entities/insights-feedback.entity';
import { InsightsRun } from './entities/insights-run.entity';
import { ForecastService } from './forecast.service';
import { InsightsService } from './insights.service';
import { InsightsRunService } from './insights-run.service';
import { DeepResearchService } from './deep-research.service';
import { InsightsHistoryService } from './insights-history.service';
import { MarketPulseService } from './market-pulse.service';
import { DashboardConfigService } from './dashboard-config.service';
import { CardProfileService } from './card-profile.service';
import { EbayMarketSource } from './card-market/ebay-market.source';
import { WebResearchMarketSource } from './card-market/web-research-market.source';
import { ValuationService } from './card-market/valuation.service';
import { PokemonPriceSource } from './card-market/pokemon-price.source';
import { EbayBrowseSource } from './card-market/ebay-browse.source';
import { AcquisitionService } from './acquisition/acquisition.service';
import { ConsentedHandlesConnector } from './acquisition/consented-handles.connector';
import { MarketService } from './market.service';
import { SoldCardsService } from './sold-cards.service';
import { RedditModule } from '../integrations/reddit/reddit.module';
import { BlueskyModule } from '../integrations/bluesky/bluesky.module';
import { YoutubeModule } from '../integrations/youtube/youtube.module';
import { GoogleSearchModule } from '../integrations/google-search/google-search.module';
import { TwitchModule } from '../integrations/twitch/twitch.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';

/**
 * Analytics-only admin module. The marketplace data-integration (collector
 * spend, buyer, and revenue analytics over our own orders/wallets) was removed
 * along with the marketplace itself — everything here now runs on external
 * market data (eBay/web research, social discovery) plus the app's own
 * analytics tables.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      SellerInventoryUpload,
      SellerInventoryItem,
      ExternalSignal,
      DiscoveredLead,
      CardForecast,
      CardMarketSnapshot,
      DeepResearchJob,
      InsightsExchange,
      MarketSnapshot,
      AnalyticsDashboard,
      TrackedCard,
      SoldCard,
      CardValuationSnapshot,
      InsightsFeedback,
      InsightsRun,
    ]),
    RedditModule,
    BlueskyModule,
    YoutubeModule,
    GoogleSearchModule,
    TwitchModule,
  ],
  controllers: [AdminController],
  providers: [
    SellerInventoryService,
    GoogleSheetsService,
    AcquisitionService,
    ConsentedHandlesConnector,
    MarketService,
    SoldCardsService,
    ForecastService,
    InsightsService,
    DeepResearchService,
    InsightsHistoryService,
    InsightsRunService,
    MarketPulseService,
    DashboardConfigService,
    CardProfileService,
    EbayMarketSource,
    WebResearchMarketSource,
    ValuationService,
    PokemonPriceSource,
    EbayBrowseSource,
  ],
  // MarketService is exported for the nightly price-alert mailer in
  // ScheduledTaskModule, which re-values holdings via the same code path the
  // dashboard uses.
  exports: [MarketService],
})
export class AdminModule {}
