import { STREAM, STREAMBET, USER } from './constants/ws.constants';
import { GatewayManager } from 'src/ws/gateway.manager';
import { AuthenticatedSocket } from 'src/interface/socket.interface';

export async function emitToUser(
  gatewayManager: GatewayManager,
  userId: string,
  event: string,
  payload: {},
) {
  const server = await gatewayManager.getServer();
  const room = userId.startsWith(USER) ? userId : `${USER}${userId}`;
  server.to(room).emit(event, payload);
}

export async function emitToStream(
  gatewayManager: GatewayManager,
  streamId: string,
  event: string,
  payload: any,
) {
  const server = await gatewayManager.getServer();
  server.to(`${STREAM}${streamId}`).emit(event, payload);
}

export async function emitToClient(
  client: AuthenticatedSocket,
  event: string,
  payload: any,
) {
  client.emit(event, payload);
}

export async function emitToStreamBet(
  gatewayManager: GatewayManager,
  event: string,
  payload: any,
) {
  const server = await gatewayManager.getServer();
  server.to(STREAMBET).emit(event, payload);
}

export async function emitToSocket(
  gatewayManager: GatewayManager,
  socketId: string | string[],
  event: string,
  payload: any,
) {
  const server = await gatewayManager.getServer();
  server.to(socketId).emit(event, payload);
}
