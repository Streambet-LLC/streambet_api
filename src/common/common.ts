import { Server } from 'socket.io';
export function emitToUser(
  server: Server,
  userId: string,
  event: string,
  payload: {},
) {
  server.to(userId).emit(event, payload);
}
