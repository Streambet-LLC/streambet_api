import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stream } from './entities/stream.entity';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { WalletsModule } from 'src/wallets/wallets.module';
import { BettingModule } from 'src/betting/betting.module';
import { QueueModule } from 'src/queue/queue.module';
import { GeoFencingModule } from 'src/geo-fencing/geo-fencing.module';
import { StreamGateway } from './stream.gateway';
import { WsModule } from 'src/ws/ws.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stream]),
    forwardRef(() => WalletsModule),
    forwardRef(() => BettingModule),
    forwardRef(() => QueueModule),
    GeoFencingModule,
    forwardRef(() => StreamModule),
    forwardRef(() => WsModule),
  ],
  controllers: [StreamController],
  providers: [StreamService, StreamGateway],
  exports: [StreamService, StreamGateway],
})
export class StreamModule {}
