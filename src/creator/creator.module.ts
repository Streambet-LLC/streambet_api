import { forwardRef, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BettingModule } from '../betting/betting.module';
import { WalletsModule } from '../wallets/wallets.module';
import { StreamModule } from 'src/stream/stream.module';
import { CreatorController } from './creator.controller';
import { CreatorService } from './creator.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stream } from 'src/stream/entities/stream.entity';
import { PlatformPayoutModule } from 'src/platform-payout/platform-payout.module';
import { CreatorApplication } from './entities/creator-application.entity';
import { User } from 'src/users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Stream, CreatorApplication]),
    WalletsModule,
    UsersModule,
    BettingModule,
    StreamModule,
    PlatformPayoutModule,
  ],
  controllers: [CreatorController],
  providers: [CreatorService],
})
export class CreatorModule {}
