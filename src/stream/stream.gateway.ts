import { forwardRef, Inject, Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { GatewayManager } from 'src/ws/gateway.manager';
import { STREAM } from 'src/common/constants/ws.constants';
import { AuthenticatedSocket } from 'src/interface/socket.interface';
import { GeoFencingSocketGuard } from 'src/auth/guards/geo-fencing-socket.guard';
import { WsJwtGuard } from 'src/auth/guards/ws-jwt.guard';
import { emitToStream, emitToStreamBet } from 'src/common/common';
import { ChatType, SocketEventName } from 'src/enums/socket.enum';
import { StreamService } from './stream.service';
import { StreamDetailsDto } from './dto/stream-detail.response.dto';
import { ChatMessage } from 'src/interface/chat-message.interface';
import { StreamList } from 'src/enums/stream-list.enum';

@WebSocketGateway()
export class StreamGateway {
  private readonly logger = new Logger(StreamGateway.name);

  /**
   * In-memory map to track viewers per stream.
   * Structure: Map<streamId, Map<userId, connectionCount>>
   */
  private viewers = new Map<string, Map<string, number>>();

  constructor(
    private readonly gatewayManager: GatewayManager,
    @Inject(forwardRef(() => StreamService))
    private readonly streamService: StreamService,
  ) {}

  /**
   * Helper to get the shared Socket.IO server instance from GatewayManager.
   */

  /**
   * Handles a user joining a stream.
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage(SocketEventName.JoinStream)
  async handleJoinStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    try {
      const userId = client.data.user.sub;
      const prev = client.data.meta;

      // Case 1: User is rejoining the same stream
      if (prev?.streamId === streamId) {
        client.join(`${STREAM}${streamId}`);
        return void this.broadcastCount(streamId);
      }

      // Case 2: User is switching from a previous stream
      if (prev?.streamId && prev.streamId !== streamId) {
        const prevRoom = `${STREAM}${prev.streamId}`;
        client.leave(prevRoom);
        this.removeViewer(prev.streamId, userId);
        void this.broadcastCount(prev.streamId);
      }

      // --- Join new stream ---
      const newRoom = `${STREAM}${streamId}`;
      client.join(newRoom);

      void emitToStream(
        this.gatewayManager,
        streamId,
        SocketEventName.JoinedStream,
        { streamId },
      );

      this.logger.log(
        `User ${client.data.user.username} joined stream ${streamId}`,
      );

      client.data.meta = { userId, streamId };

      this.addViewer(streamId, userId);
      await this.broadcastCount(streamId);
    } catch (err) {
      this.logger.error(
        `handleJoinStream failed for user ${client.data.user?.sub} stream ${streamId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Increment viewer count for a stream.
   */
  private addViewer(streamId: string, userId: string) {
    try {
      if (!this.viewers.has(streamId)) {
        this.viewers.set(streamId, new Map<string, number>());
      }

      const userConnections = this.viewers.get(streamId)!;
      const count = userConnections.get(userId) || 0;
      userConnections.set(userId, count + 1);

      this.logger.log(
        `Viewer added: stream=${streamId}, user=${userId}, connections=${count + 1}`,
      );
    } catch (err) {
      this.logger.error(
        `addViewer failed for stream ${streamId}, user ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Decrement viewer count for a stream.
   */
  removeViewer(streamId: string, userId: string) {
    try {
      const streamViewers = this.viewers.get(streamId);
      if (!streamViewers) return;

      const count = streamViewers.get(userId);
      if (!count) return;

      if (count <= 1) {
        streamViewers.delete(userId);
      } else {
        streamViewers.set(userId, count - 1);
      }

      if (streamViewers.size === 0) {
        this.viewers.delete(streamId);
      }
    } catch (err) {
      this.logger.error(
        `removeViewer failed for stream ${streamId}, user ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Broadcasts the current viewer count to all clients in the stream.
   */
  async broadcastCount(streamId: string) {
    try {
      const count = this.getViewerCount(streamId);

      void emitToStream(
        this.gatewayManager,
        streamId,
        SocketEventName.ViewerCountUpdated,
        count,
      );

      await this.streamService.updateViewerCount(streamId, count);
    } catch (err) {
      this.logger.error(
        `broadcastCount failed for stream ${streamId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Returns the number of unique viewers for a stream.
   */
  private getViewerCount(streamId: string): number {
    try {
      return this.viewers.get(streamId)?.size || 0;
    } catch (err) {
      this.logger.error(
        `getViewerCount failed for stream ${streamId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }
  }

  /**
   * Emits an event when a scheduled stream goes live.
   */
  emitScheduledStreamUpdatedToLive(streamId: string) {
    try {
      void emitToStream(
        this.gatewayManager,
        streamId,
        SocketEventName.ScheduledStreamUpdatedToLive,
        { streamId },
      );

      this.logger.log(
        `Scheduled stream updated to live event triggered for stream: ${streamId}`,
      );
    } catch (err) {
      this.logger.error(
        `emitScheduledStreamUpdatedToLive failed for stream ${streamId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Emits round details for a stream.
   */
  async emitRoundDetails(streamId: string, streamDetails: StreamDetailsDto) {
    try {
      const payload = { roundDetails: streamDetails.roundDetails };
      void emitToStream(
        this.gatewayManager,
        streamId,
        SocketEventName.RoundUpdated,
        payload,
      );
    } catch (err) {
      this.logger.error(
        `emitRoundDetails failed for stream ${streamId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Emits an event when a stream ends.
   */
  emitStreamEnd(streamId: string): void {
    try {
      const payload = { streamId, ended: true };
      const chatMessage: ChatMessage = {
        type: ChatType.System,
        username: 'StreambetBot',
        message: 'Stream has ended!',
        timestamp: new Date(),
      };

      void emitToStream(
        this.gatewayManager,
        streamId,
        SocketEventName.StreamEnded,
        payload,
      );
      void emitToStream(
        this.gatewayManager,
        streamId,
        SocketEventName.ChatMessage,
        chatMessage,
      );
    } catch (err) {
      this.logger.error(
        `emitStreamEnd failed for stream ${streamId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Handles a user leaving a stream.
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage(SocketEventName.LeaveStream)
  async handleLeaveStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    try {
      const roomName = `${STREAM}${streamId}`;
      client.leave(roomName);

      this.removeViewer(streamId, client.data.user.sub);

      if (client.data?.meta?.streamId === streamId) {
        delete client.data.meta;
      }

      await this.broadcastCount(streamId);
    } catch (err) {
      this.logger.error(
        `handleLeaveStream failed for user ${client.data.user?.sub} stream ${streamId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  /**
   * Emits a stream list update event to all clients in the 'streambet' room.
   *
   * @param event - The updated stream list object to broadcast
   *
   * This function:
   * 1. Prepares the payload with the updated stream list.
   * 2. Calls `emitToStreamBet` to broadcast the event to all clients in the 'streambet' room.
   * 3. Logs the emission for debugging purposes.
   * 4. Catches and logs any errors during the emit process.
   */
  emitStreamListEvent(event: StreamList) {
    try {
      // Prepare the payload with the updated stream list
      const payload = { event };

      // Broadcast the payload to all sockets in the 'streambet' room
      emitToStreamBet(
        this.gatewayManager,
        SocketEventName.StreamListUpdated,
        payload,
      );

      // Log success for debugging and tracking
      Logger.log(`Emitting stream list event: ${event}`);
    } catch (error) {
      // Catch and log any unexpected errors during broadcasting
      Logger.error(
        `Failed to emit stream list event: ${JSON.stringify(event)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
