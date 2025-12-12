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

@Module({
  imports: [
    TypeOrmModule.forFeature([Stream]),
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
