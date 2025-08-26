import { Server } from 'socket.io';
export function emitToUser(
  server: Server,
  userId: string,
  event: string,
  payload: {},
) {
  const room = userId.startsWith('user_') ? userId : `user_${userId}`;
  server.to(room).emit(event, payload);
}
