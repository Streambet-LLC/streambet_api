import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BettingVariable } from './entities/betting-variable.entity';
import { BettingRound } from './entities/betting-round.entity';
import { Bet } from './entities/bet.entity';
import { BetEditHistory } from './entities/bet-edit-history.entity';
import { SentimentPickVote } from './entities/sentiment-pick-vote.entity';
import { BettingService } from './betting.service';
import { SentimentPickVoteService } from './services/sentiment-pick-vote.service';
import { BettingController } from './betting.controller';
import { WalletsModule } from '../wallets/wallets.module';
import { UsersModule } from '../users/users.module';
import { Stream } from 'src/stream/entities/stream.entity';
import { StreamModule } from 'src/stream/stream.module';
import { ChatModule } from 'src/chat/chat.module';
import { GeoFencingModule } from 'src/geo-fencing/geo-fencing.module';
import { BettingGateway } from './betting.gateway';
import { WsModule } from 'src/ws/ws.module';
import { NotificationModule } from 'src/notification/notification.module';
import { PlatformPayoutModule } from 'src/platform-payout/platform-payout.module';
import { BetRoundHistoryModule } from 'src/bet-round-history/bet-round-history.module';
import { LiveFeedUpdateModule } from 'src/live-feed-update/live-feed-update.module';
import { User } from 'src/users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BettingVariable,
      BettingRound,
      User,
      Bet,
      BetEditHistory,
      SentimentPickVote,
      Stream,
    ]),
    forwardRef(() => WalletsModule),
    forwardRef(() => UsersModule),
    forwardRef(() => StreamModule), // Add StreamModule with forwardRef
    ChatModule,
    GeoFencingModule,
    forwardRef(() => WsModule),
    NotificationModule,
    PlatformPayoutModule,
    BetRoundHistoryModule,
    LiveFeedUpdateModule,
  ],
  controllers: [BettingController],
  providers: [BettingService, BettingGateway, SentimentPickVoteService],
  exports: [BettingService, BettingGateway, SentimentPickVoteService],
})
export class BettingModule {}
