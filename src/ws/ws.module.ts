import { forwardRef, Module } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { GatewayManager } from './gateway.manager';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users/users.module';
import { StreamModule } from 'src/stream/stream.module';

@Module({
  imports: [forwardRef(() => AuthModule), UsersModule, StreamModule],
  providers: [AppGateway, GatewayManager],
  exports: [GatewayManager, AppGateway],
})
export class WsModule {}
