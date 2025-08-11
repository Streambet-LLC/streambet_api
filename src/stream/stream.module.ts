import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stream } from './entities/stream.entity';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { WalletsModule } from 'src/wallets/wallets.module';
import { BettingModule } from 'src/betting/betting.module';
import { QueueModule } from 'src/queue/queue.module';
import { GeoFencingModule } from 'src/geo-fencing/geo-fencing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stream]),
    WalletsModule,
    forwardRef(() => BettingModule),
    forwardRef(() => QueueModule),GeoFencingModule
  ],
  controllers: [StreamController],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}
