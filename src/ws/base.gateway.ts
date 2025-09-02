import { OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GatewayManager } from './gateway.manager';

export abstract class BaseGateway implements OnGatewayInit {
  protected server!: Server;

  constructor(protected readonly gatewayManager: GatewayManager) {}

  afterInit(server: Server) {
    this.server = server;
    this.gatewayManager.setServer(server);
  }
}
