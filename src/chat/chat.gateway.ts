import { Logger, UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { ChatType, SocketEventName } from 'src/enums/socket.enum';
import { GatewayManager } from 'src/ws/gateway.manager';
import { ChatService } from './chat.service';
import { ChatMessage } from 'src/interface/chat-message.interface';
import { WsJwtGuard } from 'src/auth/guards/ws-jwt.guard';
// import { GeoFencingSocketGuard } from 'src/auth/guards/geo-fencing-socket.guard';
import { AuthenticatedSocket } from 'src/interface/socket.interface';
import { AuthenticatedSocketPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { emitToClient, emitToStream } from 'src/common/common';

@WebSocketGateway()
export class ChatGateway {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly gatewayManager: GatewayManager,
    private readonly chatService: ChatService,
  ) {}

  /**
   * Send a system notification to a stream.
   * Saves message in DB and emits to all clients in the stream.
   *
   * @param user - User payload triggering the system message
   * @param streamId - Stream ID where message is broadcast
   * @param systemMessage - The system notification text
   */
  async chatNotification(
    user: AuthenticatedSocketPayload,
    streamId: string,
    systemMessage: string,
  ): Promise<void> {
    try {
      const timestamp = new Date();

      // Persist system message
      await this.chatService.createChatMessage(
        streamId,
        user?.sub,
        undefined,
        undefined,
        timestamp,
        systemMessage,
      );

      // Prepare message payload for emitting
      const chatMessage: ChatMessage = {
        type: ChatType.System,
        username: user?.username || ChatType.System,
        message: '',
        systemMessage,
        imageURL: '',
        timestamp,
        profileUrl: user?.profileImageUrl,
      };

      // Emit system message to all clients in the stream
      void emitToStream(
        this.gatewayManager,
        streamId,
        SocketEventName.NewMessage,
        chatMessage,
      );
    } catch (error) {
      this.logger.error(
        'chatNotification failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Handle user chat messages.
   * Validates input, persists message, broadcasts to stream, and acknowledges sender.
   *
   * @param client - Connected socket client
   * @param data - Payload containing streamId, message, and optional imageURL
   */
  // @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage(SocketEventName.SendChatMessage)
  async handleChatMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { streamId: string; message: string; imageURL: string },
  ): Promise<void> {
    try {
      const { streamId, message, imageURL } = data;
      const user = client.data.user;

      // Validate mandatory field
      if (!streamId) {
        return void emitToClient(client, SocketEventName.MessageSent, {
          success: false,
          error: 'Stream ID cannot be empty.',
        });
      }

      const timestamp = new Date();

      try {
        // Persist user message in DB
        await this.chatService.createChatMessage(
          streamId,
          user?.sub,
          message,
          imageURL,
          timestamp,
        );
      } catch (dbError) {
        // If DB save fails, notify sender
        return void emitToClient(client, SocketEventName.MessageSent, {
          success: false,
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }

      // Prepare chat payload
      const chatMessage: ChatMessage = {
        type: ChatType.User,
        username: user?.username || ChatType.Anonymous,
        message: message.trim(),
        imageURL: imageURL || '',
        timestamp,
        profileUrl: user?.profileImageUrl,
      };

      // Emit message to all clients in the stream
      void emitToStream(
        this.gatewayManager,
        streamId,
        SocketEventName.NewMessage,
        chatMessage,
      );

      // Acknowledge sender that message was sent successfully
      void emitToClient(client, SocketEventName.MessageSent, { success: true });
    } catch (error) {
      // Catch unexpected errors
      this.logger.error(
        'handleChatMessage failed',
        error instanceof Error ? error.stack : String(error),
      );

      // Notify sender about failure
      void emitToClient(client, SocketEventName.MessageSent, {
        success: false,
        error: 'Unexpected error occurred.',
      });
    }
  }
}
