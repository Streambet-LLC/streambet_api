import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from './entities/chat.entity';
import { User } from '../users/entities/user.entity';
import { Stream } from '../stream/entities/stream.entity';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { WsModule } from 'src/ws/ws.module';
import { GeoFencingModule } from 'src/geo-fencing/geo-fencing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chat, User, Stream]),
    forwardRef(() => WsModule),
    GeoFencingModule,
  ],
  providers: [ChatService, ChatGateway],
  controllers: [ChatController],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
