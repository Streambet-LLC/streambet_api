import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BettingVariable } from './entities/betting-variable.entity';
import { BettingRound } from './entities/betting-round.entity';
import { Bet } from './entities/bet.entity';
import { BettingService } from './betting.service';
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
import { QueueModule } from 'src/queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BettingVariable, BettingRound, Bet, Stream]),
    forwardRef(() => WalletsModule),
    UsersModule,
    forwardRef(() => StreamModule), // Add StreamModule with forwardRef
    ChatModule,
    GeoFencingModule,
    forwardRef(() => WsModule),
    NotificationModule,
    QueueModule,
  ],
  controllers: [BettingController],
  providers: [BettingService, BettingGateway],
  exports: [BettingService, BettingGateway],
})
export class BettingModule {}
