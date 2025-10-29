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
// import { GeoFencingSocketGuard } from 'src/auth/guards/geo-fencing-socket.guard';
import { WsJwtGuard } from 'src/auth/guards/ws-jwt.guard';
import { emitToStream, emitToStreamBet } from 'src/common/common';
import { ChatType, SocketEventName } from 'src/enums/socket.enum';
import { StreamService } from './stream.service';
import { StreamDetailsDto } from './dto/stream-detail.response.dto';
import { ChatMessage } from 'src/interface/chat-message.interface';
import { StreamList } from 'src/enums/stream.enum';
import { RedisViewerService } from 'src/redis/redis-viewer.service';

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
    private readonly redisViewerService: RedisViewerService,
  ) {}

  /**
   * Helper to get the shared Socket.IO server instance from GatewayManager.
   */

  /**
   * JOIN a stream (handles rejoin and cross-stream switching).
   */
  @SubscribeMessage(SocketEventName.JoinStream)
  async handleJoinStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    try {
      const userId = client.data.user.sub;
      const prev = client.data.meta;

      // Case 1: User rejoining the SAME stream (e.g., page refresh or extra tab on same stream)
      if (prev?.streamId === streamId) {
        client.join(`${STREAM}${streamId}`);
        await this.redisViewerService.addConnection(streamId, userId); // increment tab count
        await this.broadcastCount(streamId);
        return;
      }

      // Case 2: Switching from a previous stream
      if (prev?.streamId && prev.streamId !== streamId) {
        const prevRoom = `${STREAM}${prev.streamId}`;
        client.leave(prevRoom);

        await this.redisViewerService.removeConnection(prev.streamId, userId);
        await this.broadcastCount(prev.streamId);
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

      await this.redisViewerService.addConnection(streamId, userId);
      await this.broadcastCount(streamId);

      // IMPORTANT: ensure we clean up on disconnect.
      if (!client.data._disconnectBound) {
        client.data._disconnectBound = true;
        client.on('disconnect', async () => {
          try {
            const meta = client.data.meta;
            if (meta?.streamId && meta?.userId) {
              await this.redisViewerService.removeConnection(
                meta.streamId,
                meta.userId,
              );
              await this.broadcastCount(meta.streamId);
            }
          } catch (err) {
            this.logger.error(
              `disconnect cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        });
      }
    } catch (err) {
      this.logger.error(
        `handleJoinStream failed for user ${client.data.user?.sub} stream ${streamId}: ${
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
  async broadcastCount(streamId: string) {
    try {
      const count =
        await this.redisViewerService.getUniqueViewerCount(streamId);

      void emitToStream(
        this.gatewayManager,
        streamId,
        SocketEventName.ViewerCountUpdated,
        count,
      );

      // Debounced write handled by StreamService
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

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SocketEventName.LeaveStream)
  async handleLeaveStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    try {
      const userId = client.data.user.sub;
      const roomName = `${STREAM}${streamId}`;
      client.leave(roomName);

      await this.redisViewerService.removeConnection(streamId, userId);
      this.removeViewer(streamId, userId);

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
  public emitStreamListEvent(event: StreamList) {
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
