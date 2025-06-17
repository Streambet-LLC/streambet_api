import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { BettingService } from './betting.service';
import { PlaceBetDto } from './dto/place-bet.dto';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { AuthService } from '../auth/auth.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

// Define socket with user data
interface AuthenticatedSocket extends Socket {
  data: {
    user: JwtPayload;
  };
}

// Define chat message interface
interface ChatMessage {
  type: 'system' | 'user';
  username: string;
  message: string;
  timestamp: Date;
}

// Define notification interface
interface Notification {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

@WebSocketGateway({
  cors: {
    origin: '*', // In production, restrict to your frontend domain
  },
})
export class BettingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly bettingService: BettingService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
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

  handleDisconnect(client: Socket): void {
    console.log(`Client disconnected: ${client.id}`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('joinStream')
  handleJoinStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    // Join the stream's room
    client.join(`stream_${streamId}`);

    // Let the client know they joined successfully
    client.emit('joinedStream', { streamId });

    console.log(`User ${client.data.user.username} joined stream ${streamId}`);

    return { event: 'joinedStream', data: { streamId } };
  }

  @UseGuards(WsJwtGuard)
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

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('placeBet')
  async handlePlaceBet(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() placeBetDto: PlaceBetDto,
  ) {
    try {
      // Get user from socket
      const user = client.data.user;

      // Place the bet
      const bet = await this.bettingService.placeBet(user.sub, placeBetDto);

      // Get the betting variable to determine the stream
      const bettingVariable = await this.bettingService.findBettingVariableById(
        bet.bettingVariableId,
      );

      // Broadcast updated betting information to all clients in the stream
      this.server
        .to(`stream_${bettingVariable.streamId}`)
        .emit('bettingUpdate', {
          bettingVariableId: bet.bettingVariableId,
          totalBetsAmount: bettingVariable.totalBetsAmount,
          betCount: bettingVariable.betCount,
        });

      // Send a chat message announcing the bet
      const chatMessage: ChatMessage = {
        type: 'system',
        username: 'StreambetBot',
        message: `${user.username} placed a bet of ${bet.amount} on ${bettingVariable.name}!`,
        timestamp: new Date(),
      };

      void this.server
        .to(`stream_${bettingVariable.streamId}`)
        .emit('chatMessage', chatMessage);

      // Confirm to the client that their bet was placed
      return {
        event: 'betPlaced',
        data: {
          bet,
          success: true,
        },
      };
    } catch (error) {
      // Send error back to client
      void client.emit('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        event: 'betPlaced',
        data: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendChatMessage')
  handleChatMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { streamId: string; message: string },
  ) {
    const { streamId, message } = data;
    const user = client.data.user;

    // Broadcast the message to all clients in the stream
    const chatMessage: ChatMessage = {
      type: 'user',
      username: user.username,
      message,
      timestamp: new Date(),
    };

    this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);

    return { event: 'messageSent', data: { success: true } };
  }

  // Method to emit betting updates to clients
  emitBettingUpdate(streamId: string, bettingVariableId: string): void {
    // Get the latest betting information and broadcast it
    void this.bettingService
      .findBettingVariableById(bettingVariableId)
      .then((bettingVariable) => {
        this.server.to(`stream_${streamId}`).emit('bettingUpdate', {
          bettingVariableId: bettingVariable.id,
          totalBetsAmount: bettingVariable.totalBetsAmount,
          betCount: bettingVariable.betCount,
          status: bettingVariable.status,
        });
      })
      .catch((error) =>
        console.error(
          `Error emitting betting update: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        ),
      );
  }

  // Method to notify users when betting is locked
  emitBettingLocked(streamId: string, bettingVariableId: string): void {
    // Send a chat message
    const chatMessage: ChatMessage = {
      type: 'system',
      username: 'StreambetBot',
      message: 'Betting is now locked! No more bets can be placed.',
      timestamp: new Date(),
    };

    void this.server.to(`stream_${streamId}`).emit('bettingLocked', {
      bettingVariableId,
    });

    void this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);
  }

  // Method to notify users when a winner is declared
  emitWinnerDeclared(
    streamId: string,
    bettingVariableId: string,
    winnerName: string,
  ): void {
    this.server.to(`stream_${streamId}`).emit('winnerDeclared', {
      bettingVariableId,
      winnerName,
    });

    // Send a chat message
    const chatMessage: ChatMessage = {
      type: 'system',
      username: 'StreambetBot',
      message: `The winner is: ${winnerName}!`,
      timestamp: new Date(),
    };

    this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);
  }

  // Method to send a notification to a specific user
  sendUserNotification(userId: string, notification: Notification): void {
    // Find all sockets for this user and send them the notification
    const sockets = this.server.sockets.sockets;

    sockets.forEach((socket) => {
      const authenticatedSocket = socket as AuthenticatedSocket;
      if (authenticatedSocket.data?.user?.sub === userId) {
        authenticatedSocket.emit('notification', notification);
      }
    });
  }
}
