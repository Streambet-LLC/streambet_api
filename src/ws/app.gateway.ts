import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { GatewayManager } from './gateway.manager';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import { AuthenticatedSocket, UserMeta } from 'src/interface/socket.interface';
import { AuthService } from 'src/auth/auth.service';
import { UsersService } from 'src/users/users.service';
import { USER } from 'src/common/constants/ws.constants';
import { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { StreamGateway } from 'src/stream/stream.gateway';

/**
 * Main WebSocket Gateway for handling connections across the app.
 * Responsibilities:
 * - Authenticate users via JWT
 * - Map users to sockets and manage rooms
 * - Handle connect / disconnect lifecycle
 * - Provide reverse lookup for socket → user
 */
@WebSocketGateway({ cors: true }) // Finalized by custom adapter
export class AppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;

  // username → Set<socketId> (tracks all active sockets for a user by username)
  userSocketMap = new Map<string, Set<string>>();

  // socketId → username (reverse lookup for userSocketMap cleanup)
  private socketIdToUsername = new Map<string, string>();

  constructor(
    private readonly manager: GatewayManager,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly userService: UsersService,
    private readonly streamGateway: StreamGateway,
  ) {}

  /**
   * Called when the gateway is initialized.
   * - Stores reference to the server inside GatewayManager
   */
  afterInit(server: Server) {
    this.manager.setServer(server);
  }

  /**
   * Handles a new client socket connection.
   * Flow:
   * 1. Verify JWT token from handshake (auth or headers)
   * 2. Decode payload & fetch user profile
   * 3. Store user metadata inside socket
   * 4. Join user-specific room
   * 5. Add socket to tracking maps
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      // Extract token from handshake (either `auth` or `authorization` header)
      const rawToken =
        client.handshake.auth?.token ?? client.handshake.headers.authorization;
      const token =
        typeof rawToken === 'string'
          ? rawToken.replace(/^Bearer\s+/i, '')
          : undefined;

      if (!token) {
        return this.forceDisconnect(client, 'Missing token');
      }

      // Verify JWT (returns decoded payload if valid)
      const decoded = this.authService.verifyRefreshToken(token);
      if (!decoded) {
        return this.forceDisconnect(client, 'Invalid token');
      }

      // Fetch additional user profile (like profileImage)
      const userData = await this.fetchUserData(decoded);

      // Store user metadata in socket (typed via AuthenticatedSocket)
      const authenticatedSocket = client as AuthenticatedSocket;
      authenticatedSocket.data = { user: userData };

      const userId = userData.sub;
      if (!userId) {
        return this.forceDisconnect(
          client,
          'Invalid token payload (missing sub)',
        );
      }
      // Create/join a dedicated room for this user
      const userRoom = `${USER}${userId}`;
      client.join(userRoom);

      // Delegate tracking to central manager
      this.manager.registerConnection(client, userId);

      // ALSO populate the userSocketMap for username-based lookups
      const username = userData.username;
      if (username) {
        if (!this.userSocketMap.has(username)) {
          this.userSocketMap.set(username, new Set());
        }
        this.userSocketMap.get(username)!.add(client.id);
        // Store reverse mapping for cleanup
        this.socketIdToUsername.set(client.id, username);
      }

      Logger.log(
        `Client connected: ${client.id}, user: ${userData.username ?? 'unknown'}`,
        AppGateway.name,
      );
    } catch (error) {
      Logger.error(
        `Connection error: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        AppGateway.name,
      );
      this.forceDisconnect(client, 'Unexpected error');
    }
  }

  /**
   * Fetch user profile info safely from DB.
   * Adds profileImageUrl if found.
   */
  private async fetchUserData(decoded: JwtPayload) {
    try {
      const { profileImageUrl } = await this.userService.findUserByUserId(
        decoded.sub,
      );
      return { ...decoded, profileImageUrl };
    } catch (err) {
      Logger.warn(
        `Profile fetch failed for user ${decoded.sub}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        AppGateway.name,
      );
      // Fallback: return payload without profile image
      return { ...decoded, profileImageUrl: undefined };
    }
  }

  /**
   * Handles socket disconnection.
   * Flow:
   * 1. Cleanup socket from maps
   * 2. Update betting stream viewer count (if meta available)
   */
  async handleDisconnect(client: Socket): Promise<void> {
    // Remove socket from tracking maps
    this.cleanupSocket(client);

    // If socket had stream viewing metadata → update viewer count
    const meta = client.data?.meta as UserMeta;
    if (meta) {
      this.streamGateway.removeViewer(meta.streamId, meta.userId);
      void this.streamGateway.broadcastCount(meta.streamId);
    }

    Logger.log(
      `Client disconnected: ${client.data?.user?.username || client.id}`,
      AppGateway.name,
    );
  }

  /**
   * Forcefully disconnects a socket.
   * - Cleans up maps
   * - Logs reason
   * - Terminates connection
   */
  private forceDisconnect(client: Socket, reason: string) {
    this.cleanupSocket(client);
    Logger.warn(
      `Disconnecting client ${client.id}: ${reason}`,
      AppGateway.name,
    );
    client.disconnect(true);
  }

  /**
   * Removes socket references from both maps.
   * Ensures memory cleanup on disconnect.
   */
  private cleanupSocket(client: Socket) {
    // Cleanup username-based mapping
    const username = this.socketIdToUsername.get(client.id);
    if (username) {
      const sockets = this.userSocketMap.get(username);
      sockets?.delete(client.id);
      if (sockets?.size === 0) {
        this.userSocketMap.delete(username);
      }
      this.socketIdToUsername.delete(client.id);
    }

    // Remove from central manager
    this.manager.removeConnection(client);
  }
}
