import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiveFeedUpdate } from './live-feed-update.entity';
import { LiveFeedUpdateService } from './live-feed-update.service';
import { WsModule } from 'src/ws/ws.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LiveFeedUpdate]),
    forwardRef(() => WsModule),
  ],
  providers: [LiveFeedUpdateService],
  exports: [LiveFeedUpdateService],
})
export class LiveFeedUpdateModule {}
