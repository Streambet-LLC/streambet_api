// chat.gateway.ts
import { UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from 'src/auth/auth.service';
import { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
interface ChatMessage {
  type: 'system' | 'user';
  username: string;
  message: string;
  timestamp: Date;
}
interface ChatPayload {
  streamId: string;
  message: string;
  username: string;
}
interface AuthenticatedSocket extends Socket {
  data: {
    user: JwtPayload;
  };
}
//replace '*' with specific frontend domain(s) for security.

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  constructor(private readonly authService: AuthService) {}
  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake
      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        client.disconnect();
        await Promise.resolve();
        return;
      }

      // Verify token and get user
      const decoded = this.authService.verifyRefreshToken(token);
      if (!decoded) {
        client.disconnect();
        await Promise.resolve();
        return;
      }

      // Explicitly cast to JwtPayload since we've already verified it's not null
      const authenticatedSocket = client as AuthenticatedSocket;

      authenticatedSocket.data = {
        user: decoded,
      };

      console.log(
        `Client connected: ${client.id}, user: ${
          typeof decoded.username === 'string' ? decoded.username : 'unknown'
        }`,
      );
    } catch (error) {
      console.error(
        `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }
  @SubscribeMessage('joinStream')
  handleJoinStream(
    @MessageBody() streamId: string,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    client.join(`stream_${streamId}`);
    console.log(`User ${client.data.user.username} joined stream ${streamId}`);
    return { event: 'joinedStream', data: { streamId } };
  }

  @SubscribeMessage('leaveStream')
  handleLeaveStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    // Leave the stream's room
    client.leave(`stream_${streamId}`);

    console.log(`User ${client.data.user.username} left stream ${streamId}`);

    return { event: 'leftStream', data: { streamId } };
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @MessageBody() payload: ChatPayload,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const { streamId } = payload;
    const user = client.data.user;
    this.server.to(`stream_${streamId}`).emit('receiveMessage', {
      message: payload.message,
      username: user.username,
      timestamp: new Date().toISOString(),
    });
    const chatMessage: ChatMessage = {
      type: 'user',
      username: user.username,
      message: 'Message received',
      timestamp: new Date(),
    };
    void this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);
  }
}
