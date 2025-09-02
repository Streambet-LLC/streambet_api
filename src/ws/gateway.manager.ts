import { Injectable, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

@Injectable()
export class GatewayManager {
  private server?: Server;
  private serverPromise: Promise<Server>;
  private resolveServer?: (server: Server) => void;

  // Maps for faster lookups
  readonly socketIdToUserId = new Map<string, string>();
  readonly userIdToSocketIds = new Map<string, Set<string>>();

  constructor() {
    this.serverPromise = new Promise<Server>((resolve) => {
      this.resolveServer = resolve;
    });
  }

  /** Set server once */
  setServer(server: Server) {
    if (this.server) {
      Logger.warn(
        'setServer called more than once – ignoring',
        GatewayManager.name,
      );
      return;
    }
    this.server = server;
    this.resolveServer?.(server);
    this.resolveServer = undefined;
  }

  /** Async: always returns initialized server */
  getServer(): Promise<Server> {
    return this.serverPromise;
  }

  /** Sync: returns server if ready, otherwise throws */
  getServerSync(): Server {
    if (!this.server) throw new Error('Socket server not initialized yet');
    return this.server;
  }

  /** Execute callback with initialized server */
  async withServer<T>(cb: (server: Server) => T | Promise<T>): Promise<T> {
    const srv = await this.serverPromise;
    return cb(srv);
  }

  /** Check if server is initialized */
  isReady(): boolean {
    return !!this.server;
  }

  /** Track user ↔ socket mapping */
  registerConnection(socket: Socket, userId: string) {
    this.socketIdToUserId.set(socket.id, userId);

    if (!this.userIdToSocketIds.has(userId)) {
      this.userIdToSocketIds.set(userId, new Set());
    }
    this.userIdToSocketIds.get(userId)!.add(socket.id);
  }

  /** Remove mapping on disconnect */
  removeConnection(socket: Socket) {
    const userId = this.socketIdToUserId.get(socket.id);
    if (!userId) return;

    this.socketIdToUserId.delete(socket.id);

    const sockets = this.userIdToSocketIds.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) this.userIdToSocketIds.delete(userId);
    }
  }

  /** Get userId by socketId */
  getUserId(socketId: string): string | undefined {
    return this.socketIdToUserId.get(socketId);
  }

  /** Get all socketIds for a user */
  getSocketIds(userId: string): string[] {
    return Array.from(this.userIdToSocketIds.get(userId) ?? []);
  }

  /** Disconnect all sockets for a user */
  async disconnectUser(userId: string, reason = 'force-disconnect') {
    if (!this.server) return;

    const sockets = this.userIdToSocketIds.get(userId);
    if (!sockets) return;

    for (const socketId of Array.from(sockets)) {
      // proactively clear reverse mapping; disconnect will also trigger removeConnection
      this.socketIdToUserId.delete(socketId);
      const socket = this.server.sockets.sockets.get(socketId);
      socket?.disconnect(true);
    }

    this.userIdToSocketIds.delete(userId);
  }
}
