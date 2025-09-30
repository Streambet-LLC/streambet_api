import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

// Define socket with user data
interface AuthenticatedSocket extends Socket {
  data: {
    user: JwtPayload;
  };
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Get the client socket
    const client: Socket = context.switchToWs().getClient();
    const authenticatedClient = client as AuthenticatedSocket;

    // Check if user data exists in the socket
    // This would have been set during the handleConnection method
    if (!authenticatedClient.data?.user) {
      throw new WsException('Unauthorized');
    }

    return true;
  }
}
