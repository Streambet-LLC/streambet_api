import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/**
 * Auctions gateway. Each auction has its own room `auction:{id}`.
 * Clients viewing an auction page join the room to receive:
 *   - bid.placed
 *   - auction.extended
 *   - auction.cancelled
 *   - auction.closed (emitted by close job)
 *
 * Authentication is handled by the global socket adapter / AppGateway
 * connection logic; this gateway only adds the join/leave message
 * handlers and the broadcast helper.
 */
@Injectable()
@WebSocketGateway({ cors: true })
export class AuctionsGateway {
  private readonly logger = new Logger(AuctionsGateway.name);

  @WebSocketServer() private server: Server;

  private roomFor(auctionId: string): string {
    return `auction:${auctionId}`;
  }

  /** Client joins an auction room to start receiving live updates. */
  @SubscribeMessage('auction.join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { auctionId: string },
  ): Promise<{ ok: true }> {
    if (body?.auctionId) {
      await client.join(this.roomFor(body.auctionId));
    }
    return { ok: true };
  }

  @SubscribeMessage('auction.leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { auctionId: string },
  ): Promise<{ ok: true }> {
    if (body?.auctionId) {
      await client.leave(this.roomFor(body.auctionId));
    }
    return { ok: true };
  }

  /**
   * Broadcast helper used by AuctionsService and the close job.
   * Safe to call before the server is initialized — falls back to a
   * no-op log instead of throwing.
   */
  emitAuctionUpdate(auctionId: string, payload: Record<string, unknown>): void {
    if (!this.server) {
      this.logger.warn(
        `Socket server not ready; dropping auction update for ${auctionId}`,
      );
      return;
    }
    this.server.to(this.roomFor(auctionId)).emit('auction.update', payload);
  }
}
