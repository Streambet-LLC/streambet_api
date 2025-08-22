import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BettingVariable } from './entities/betting-variable.entity';
import { BettingRound } from './entities/betting-round.entity';
import { Bet } from './entities/bet.entity';
import { BettingService } from './betting.service';
import { BettingController } from './betting.controller';
import { BettingGateway } from './betting.gateway';
import { WalletsModule } from '../wallets/wallets.module';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { Stream } from 'src/stream/entities/stream.entity';
import { StreamModule } from 'src/stream/stream.module';
import { NotificationService } from 'src/notification/notification.service';
import { EmailsService } from 'src/emails/email.service';
import { ChatModule } from 'src/chat/chat.module';
import { GeoFencingModule } from 'src/geo-fencing/geo-fencing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BettingVariable, BettingRound, Bet, Stream]),
    WalletsModule,
    UsersModule,
    AuthModule,
    forwardRef(() => StreamModule), // Add StreamModule with forwardRef
    ChatModule,
    GeoFencingModule,
  ],
  controllers: [BettingController],
  providers: [
    BettingService,
    BettingGateway,
    NotificationService,
    EmailsService,
  ],
  exports: [BettingService, BettingGateway],
})
export class BettingModule {}
