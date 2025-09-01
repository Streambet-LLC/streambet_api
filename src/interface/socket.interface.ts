import { AuthenticatedSocketPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { Socket } from 'socket.io';

export interface UserMeta {
  userId: string;
  streamId: string;
}

export interface AuthenticatedSocket extends Socket {
  data: {
    meta?: UserMeta;
    user: AuthenticatedSocketPayload;
  };
}
