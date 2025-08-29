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
import { UseGuards, Inject, forwardRef, Logger } from '@nestjs/common';
import { BettingService } from './betting.service';
import { PlaceBetDto, EditBetDto } from './dto/place-bet.dto';
import { CancelBetDto } from './dto/cancel-bet.dto';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedSocketPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrencyType } from '../wallets/entities/transaction.entity';
import { WalletsService } from '../wallets/wallets.service';
import { StreamService } from 'src/stream/stream.service';
import { NOTIFICATION_TEMPLATE } from 'src/notification/notification.templates';
import { NotificationService } from 'src/notification/notification.service';
import { PlaceBetResult } from 'src/interface/betPlace.interface';
import { CancelBetPayout } from 'src/interface/betCancel.interface';
import { EditedBetPayload } from 'src/interface/betEdit.interface';
import { ChatService } from '../chat/chat.service';
import { UsersService } from 'src/users/users.service';
import { StreamList } from 'src/enums/stream-list.enum';
import { UserRole } from 'src/users/entities/user.entity';
import { StreamDetailsDto } from 'src/stream/dto/stream-detail.response.dto';
import { UserMeta } from 'src/interface/user-meta.interface';
import { emitToUser } from 'src/common/common';
import { SocketEventName } from 'src/enums/socket-event-name.enum';
import { GeoFencingSocketGuard } from 'src/auth/guards/geo-fencing-socket.guard';

// Define socket with user data
interface AuthenticatedSocket extends Socket {
  data: {
    meta?: UserMeta;
    user: AuthenticatedSocketPayload;
  };
}

// Define chat message interface
interface ChatMessage {
  type: 'system' | 'user';
  username: string;
  message: string;
  timestamp: Date;
  imageURL?: string;
  title?: string;
  profileUrl?: string;
  systemMessage?: string;
}

// Define notification interface
interface Notification {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class BettingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;
  // Memory store: streamId -> userId -> connectionCount
  private viewers = new Map<string, Map<string, number>>();
  private userSocketMap = new Map<string, string>();
  constructor(
    @Inject(forwardRef(() => BettingService))
    private readonly bettingService: BettingService,
    private readonly authService: AuthService,
    private readonly walletsService: WalletsService,
    private readonly streamService: StreamService,
    private readonly notificationService: NotificationService,
    private readonly userService: UsersService,
    private readonly chatService: ChatService, // Inject ChatService
  ) {}

  /**
   * Handles a new client socket connection.
   * - Verifies JWT token from handshake
   * - Fetches user profile
   * - Stores authenticated user data in socket
   * - Joins the user-specific room for private messages
   *
   * @param client - The connected socket client
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      // Extract token from handshake (auth field or Authorization header)
      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.split(' ')[1];

      // If no token, disconnect client
      if (!token) {
        client.disconnect();
        await Promise.resolve();
        return;
      }

      // Verify token
      const decoded = this.authService.verifyRefreshToken(token);
      if (!decoded) {
        client.disconnect();
        await Promise.resolve();
        return;
      }

      try {
        // Fetch additional user info (like profile image)
        const { profileImageUrl } = await this.userService.findById(
          decoded.sub,
        );

        const updatedDecode = { ...decoded, profileImageUrl };

        // Cast socket to AuthenticatedSocket and attach user data
        const authenticatedSocket = client as AuthenticatedSocket;
        authenticatedSocket.data = { user: updatedDecode };
      } catch (userError) {
        console.error(`Failed to fetch user profile: ${userError.message}`);

        // Still allow connection but without profile image
        const authenticatedSocket = client as AuthenticatedSocket;
        authenticatedSocket.data = {
          user: { ...decoded, profileImageUrl: undefined },
        };
      }

      // Join a user-specific room for private events
      const userId = client.data?.user?.sub;
      if (userId) {
        client.join(`user_${userId}`);
      }

      // Log connection info
      Logger.log(
        `Client connected: ${client.id}, user: ${
          typeof decoded.username === 'string' ? decoded.username : 'unknown'
        }`,
      );
    } catch (error) {
      // Catch any unexpected errors and disconnect client
      console.error(
        `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      client.disconnect();
    }
  }

  /**
   * Handles socket disconnection.
   * - Removes user from internal socket map
   * - Updates live stream viewer count
   * - Leaves the user-specific room
   *
   * @param client - The disconnecting socket client
   */
  async handleDisconnect(client: Socket): Promise<void> {
    // Remove user from active socket map
    const username = client.data?.user?.username;
    if (username) {
      this.userSocketMap.delete(username);
    }

    // Handle live stream viewer count
    const meta = client.data?.meta as UserMeta;
    if (meta) {
      this.removeViewer(meta.streamId, meta.userId); // decrement viewer count
      void this.broadcastCount(meta.streamId); // broadcast updated count
    }

    // Leave private user room
    const userId = client.data?.user?.sub;
    if (userId) {
      client.leave(`user_${userId}`);
    }

    // Log disconnection
    Logger.log(`${username || client.id} disconnected`);
    Logger.log(`Client disconnected: ${username || client.id}`);
  }

  /**
   * Handles user joining a live stream via WebSocket.
   * - Supports idempotent joins: multiple joins to the same stream won't duplicate counts.
   * - Handles switching between streams: decrements previous stream's viewer count.
   * - Tracks unique viewers (not tabs) per stream.
   * - Broadcasts live viewer count to all connected clients in the stream.
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage('joinStream')
  async handleJoinStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    const userId = client.data.user.sub; // Extract user ID from authenticated socket
    const prev = client.data.meta; // Retrieve previous stream info, if any

    // --- Case 1: User is already in the same stream (idempotent join) ---
    if (prev?.streamId === streamId) {
      client.join(`stream_${streamId}`); // socket.io ignores duplicate joins
      return void this.broadcastCount(streamId); // update live viewer count
    }

    // --- Case 2: User is switching streams ---
    if (prev?.streamId && prev.streamId !== streamId) {
      client.leave(`stream_${prev.streamId}`); // leave previous stream room
      this.removeViewer(prev.streamId, userId); // decrement previous stream viewer count
      void this.broadcastCount(prev.streamId); // broadcast updated count for previous stream
    }

    // --- Join the new stream ---
    client.join(`stream_${streamId}`); // join new stream room
    this.server.to(`stream_${streamId}`).emit('joinedStream', { streamId }); // notify all users in the stream
    Logger.log(`User ${client.data.user.username} joined stream ${streamId}`); // log join event

    // --- Save user meta info for this socket ---
    client.data.meta = { userId, streamId };

    // --- Increment new stream viewer count and broadcast to all users ---
    this.addViewer(streamId, userId); // track number of tabs/connections per user
    await this.broadcastCount(streamId); // update live viewer count for new stream
  }

  /**
   * Add a viewer to the internal tracking map.
   * Supports multiple tabs per user by counting connections per user.
   */
  private addViewer(streamId: string, userId: string) {
    // Initialize the stream map if it doesn't exist
    if (!this.viewers.has(streamId)) {
      this.viewers.set(streamId, new Map<string, number>());
    }

    const userConnections = this.viewers.get(streamId)!;

    // Increment the number of connections (tabs) for this user
    const count = userConnections.get(userId) || 0;
    userConnections.set(userId, count + 1);

    Logger.log(
      `Viewer added: stream=${streamId}, user=${userId}, connections=${count + 1}`,
    );
  }

  /**
   * Remove a viewer from the internal tracking map.
   * Decrements tab count and removes user entirely if no tabs remain.
   */
  private removeViewer(streamId: string, userId: string) {
    const streamViewers = this.viewers.get(streamId);
    if (!streamViewers) return; // no viewers for this stream

    const count = streamViewers.get(userId);
    if (!count) return; // user not found in viewers

    if (count <= 1) {
      streamViewers.delete(userId); // remove user completely if no tabs left
    } else {
      streamViewers.set(userId, count - 1); // decrement tab count
    }

    // Remove stream from map if no users remain
    if (streamViewers.size === 0) {
      this.viewers.delete(streamId);
    }
  }

  /**
   * Get the total number of unique viewers (users) for a stream.
   * Tabs per user are counted only once.
   */
  private getViewerCount(streamId: string): number {
    return this.viewers.get(streamId)?.size || 0;
  }

  /**
   * Broadcast the updated viewer count to all connected clients in a stream.
   * Also updates the database with the new viewer count.
   */
  private async broadcastCount(streamId: string) {
    const count = this.getViewerCount(streamId);
    try {
      // Emit updated viewer count to all clients in the stream room
      this.server.to(`stream_${streamId}`).emit('viewerCountUpdated', count);

      // Persist viewer count in DB (in production, consider debounce/throttle)
      await this.streamService.updateViewerCount(streamId, count);
    } catch (err) {
      Logger.error(
        `broadcastCount failed for stream ${streamId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  /**
   * Handles a user leaving a live stream.
   * - Leaves the stream room in socket.io.
   * - Updates in-memory viewer count.
   * - Clears meta info if leaving the current stream.
   * - Broadcasts updated viewer count to all connected clients.
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage('leaveStream')
  async handleLeaveStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    const roomName = `stream_${streamId}`;
    client.leave(roomName); // leave the socket.io room

    // Remove viewer from in-memory map (handles multiple tabs per user)
    this.removeViewer(streamId, client.data.user.sub);

    // Clear meta if leaving the current stream
    if (client.data?.meta?.streamId === streamId) {
      delete client.data.meta;
    }

    // Broadcast updated viewer count to remaining users
    await this.broadcastCount(streamId);
  }

  /**
   * Handles a user joining the stream bet room.
   * - Adds the user to a common 'streambet' room for betting events.
   * - Stores mapping of username -> socket ID for targeted events.
   * - Broadcasts join event to all users in 'streambet' room.
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage('joinStreamBet')
  async handleJoinStreamBet(@ConnectedSocket() client: AuthenticatedSocket) {
    const username = client.data.user.username;
    client.join(`streambet`); // join common betting room

    // Track socket ID for this user
    this.userSocketMap.set(username, client.id);

    // Notify all users in 'streambet' room
    this.server.to(`streambet`).emit('joinedStreamBet', { username });

    Logger.log(`User ${username} joined room streambet`);
  }

  /**
   * Handles a user leaving the stream bet room.
   * - Removes the user from 'streambet' room.
   * - Optionally returns the leave event info.
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage('leaveStreamBet')
  async handleLeaveStreamBet(@ConnectedSocket() client: AuthenticatedSocket) {
    const username = client.data.user.username;
    client.leave(`streambet`); // leave the betting room

    Logger.log(`User ${username} left streambet`);

    // Notify the client or log for reference
    return { event: 'leaveStreamBet', data: { username } };
  }

  /**
   * Handle placing a bet by a user.
   * - Saves the bet to DB
   * - Updates user wallet
   * - Emits confirmation only to user's active sockets
   * - Broadcasts updated betting stats to all clients in the stream
   * - Sends system chat messages
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage('placeBet')
  async handlePlaceBet(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() placeBetDto: PlaceBetDto,
  ) {
    try {
      const user = client.data.user;

      // Place the bet via service
      const { bet, roundId } = await this.bettingService.placeBet(
        user.sub,
        placeBetDto,
      );

      // Fetch updated wallet and betting variable concurrently
      const [updatedWallet, bettingVariable] = await Promise.all([
        this.walletsService.findByUserId(user.sub),
        this.bettingService.findBettingVariableById(bet.bettingVariableId),
      ]);

      // Calculate potential winnings
      let potentialAmount = null;
      if (roundId) {
        try {
          potentialAmount = await this.bettingService.findPotentialAmount(
            user.sub,
            roundId,
          );
        } catch (e) {
          console.error('Potential amount error:', e.message);
        }
      }

      // Prepare payload for the user's socket
      let betPlacePayload: PlaceBetResult = {
        bet,
        success: true,
        currencyType: placeBetDto.currencyType,
        potentialSweepCoinWinningAmount:
          potentialAmount?.potentialSweepCoinAmt || 0,
        potentialGoldCoinWinningAmount:
          potentialAmount?.potentialGoldCoinAmt || 0,
        amount: placeBetDto.amount,
        selectedWinner: bettingVariable?.name || '',
        updatedWalletBalance: {
          goldCoins: updatedWallet.goldCoins,
          sweepCoins: updatedWallet.sweepCoins,
        },
      };

      // Add notification if user has in-app notifications enabled
      const receiverNotificationPermission =
        await this.notificationService.addNotificationPermision(user.sub);
      if (receiverNotificationPermission['inAppNotification']) {
        betPlacePayload.message = NOTIFICATION_TEMPLATE.BET_PLACED.MESSAGE({
          amount: placeBetDto.amount,
          currencyType: placeBetDto.currencyType,
          bettingOption: bettingVariable?.name || '',
          roundName: bettingVariable.round.roundName || '',
        });
        betPlacePayload.title = NOTIFICATION_TEMPLATE.BET_PLACED.TITLE();
      }

      // Emit confirmation to user's own active sockets
      this.server.sockets.sockets.forEach((socket) => {
        const authSocket = socket as AuthenticatedSocket;
        if (authSocket.data?.user?.sub === user.sub) {
          authSocket.emit('betPlaced', betPlacePayload);
        }
      });

      // Broadcast updated betting stats to all clients
      if (bettingVariable) {
        const updatedBettingVariable =
          await this.bettingService.findBettingVariableById(bettingVariable.id);
        const roundIdEmit =
          updatedBettingVariable.roundId || updatedBettingVariable.round?.id;
        const roundTotals =
          await this.bettingService.getRoundTotals(roundIdEmit);

        // Admin-specific betting stats
        let betStat = {};
        if (user.role === UserRole.ADMIN) {
          betStat = await this.bettingService.getBetStatsByStream(
            bettingVariable.stream.id,
          );
        }

        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('bettingUpdate', {
            roundId: roundIdEmit,
            totalBetsSweepCoinAmount: roundTotals.totalBetsSweepCoinAmount,
            totalBetsGoldCoinAmount: roundTotals.totalBetsGoldCoinAmount,
            totalSweepCoinBet: roundTotals.totalSweepCoinBet,
            totalGoldCoinBet: roundTotals.totalGoldCoinBet,
            ...betStat,
          });

        // Personalized potential amounts for all users
        await this.sendPersonalizedPotentialAmounts(
          bettingVariable.stream.id,
          roundIdEmit,
        );

        // System chat notification for bet placement
        const chatMessage: ChatMessage = {
          type: 'system',
          username: 'StreambetBot',
          message: `${user.username} placed a bet of ${bet.amount} on ${bettingVariable.name}!`,
          timestamp: new Date(),
        };
        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('chatMessage', chatMessage);

        // Send optional chat notifications via service
        const systemMessage =
          NOTIFICATION_TEMPLATE.PLACE_BET_CHAT_MESSAGE.MESSAGE({
            username: user.username,
            amount: bet.amount,
            bettingOption: bettingVariable.name,
          });
        await this.chatNotification(
          user,
          bettingVariable.stream.id,
          systemMessage,
        );
      }
    } catch (error) {
      void client.emit('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Handle bet cancellation by user
   * - Refunds wallet
   * - Emits cancellation confirmation only to user's sockets
   * - Updates stream betting stats and sends system messages
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage('cancelBet')
  async handleCancelBet(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { betId: string; currencyType: CurrencyType },
  ) {
    try {
      const user = client.data.user;

      const cancelBetDto: CancelBetDto = {
        betId: data.betId,
        currencyType: data.currencyType,
      };

      const bet = await this.bettingService.cancelBet(user.sub, cancelBetDto);

      const [updatedWallet, bettingVariable] = await Promise.all([
        this.walletsService.findByUserId(user.sub),
        this.bettingService.findBettingVariableById(bet.bettingVariableId),
      ]);

      const roundId = bettingVariable?.roundId || bettingVariable?.round?.id;

      let betCancelPayout: CancelBetPayout = {
        bet,
        success: true,
        updatedWalletBalance: {
          goldCoins: updatedWallet.goldCoins,
          sweepCoins: updatedWallet.sweepCoins,
        },
      };

      const receiverNotificationPermission =
        await this.notificationService.addNotificationPermision(user.sub);
      if (receiverNotificationPermission['inAppNotification']) {
        betCancelPayout.message = NOTIFICATION_TEMPLATE.BET_CANCELLED.MESSAGE({
          amount: bet.amount,
          currencyType: bet.currency,
          bettingOption: bettingVariable?.name || '',
          roundName: bettingVariable.round.roundName || '',
        });
        betCancelPayout.title = NOTIFICATION_TEMPLATE.BET_CANCELLED.TITLE();
      }

      // Emit to user's own sockets
      this.server.sockets.sockets.forEach((socket) => {
        const authSocket = socket as AuthenticatedSocket;
        if (authSocket.data?.user?.sub === user.sub) {
          authSocket.emit('betCancelled', betCancelPayout);
        }
      });

      // Broadcast updated betting stats
      if (bettingVariable) {
        const updatedBettingVariable =
          await this.bettingService.findBettingVariableById(bettingVariable.id);
        const roundIdEmit =
          updatedBettingVariable.roundId || updatedBettingVariable.round?.id;

        const roundTotals =
          await this.bettingService.getRoundTotals(roundIdEmit);

        let betStat = {};
        if (user.role === UserRole.ADMIN) {
          betStat = await this.bettingService.getBetStatsByStream(
            bettingVariable.stream.id,
          );
        }

        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('bettingUpdate', {
            roundId: roundIdEmit,
            totalBetsSweepCoinAmount: roundTotals.totalBetsSweepCoinAmount,
            totalBetsGoldCoinAmount: roundTotals.totalBetsGoldCoinAmount,
            totalSweepCoinBet: roundTotals.totalSweepCoinBet,
            totalGoldCoinBet: roundTotals.totalGoldCoinBet,
            ...betStat,
          });

        await this.sendPersonalizedPotentialAmounts(
          bettingVariable.stream.id,
          roundIdEmit,
        );

        // System chat message
        const chatMessage: ChatMessage = {
          type: 'system',
          username: 'StreambetBot',
          message: `${user.username} cancelled their bet of ${bet.amount} on ${bettingVariable.name}!`,
          timestamp: new Date(),
        };
        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('chatMessage', chatMessage);
      }
    } catch (error) {
      client.emit('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Handle editing a bet by user
   * - Updates bet amount
   * - Updates wallet and potential winnings
   * - Emits edit confirmation only to user's sockets
   * - Broadcasts updated betting stats to all clients
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage('editBet')
  async handleEditBet(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() editBetDto: EditBetDto,
  ) {
    try {
      const user = client.data.user;

      // Edit bet in service
      const { betDetails: editedBet, oldBettingAmount } =
        await this.bettingService.editBet(user.sub, editBetDto);

      const [updatedWallet, bettingVariable] = await Promise.all([
        this.walletsService.findByUserId(user.sub),
        this.bettingService.findBettingVariableById(
          editedBet.bettingVariableId,
        ),
      ]);

      const roundId = bettingVariable?.roundId || bettingVariable?.round?.id;

      let potentialAmount = null;
      if (roundId) {
        try {
          potentialAmount = await this.bettingService.findPotentialAmount(
            user.sub,
            roundId,
          );
        } catch (e) {
          console.error('Potential amount error:', e.message);
        }
      }

      // Prepare payload
      let betEditedPayload: EditedBetPayload = {
        bet: editedBet,
        success: true,
        timestamp: new Date(),
        currencyType: editedBet.currency,
        potentialSweepCoinWinningAmount:
          potentialAmount?.potentialSweepCoinAmt || 0,
        potentialGoldCoinWinningAmount:
          potentialAmount?.potentialGoldCoinAmt || 0,
        amount: editedBet.amount,
        selectedWinner: bettingVariable?.name || '',
        updatedWalletBalance: {
          goldCoins: updatedWallet.goldCoins,
          sweepCoins: updatedWallet.sweepCoins,
        },
      };

      // Add notification
      const receiverNotificationPermission =
        await this.notificationService.addNotificationPermision(user.sub);
      if (receiverNotificationPermission['inAppNotification']) {
        if (Number(oldBettingAmount) < Number(editedBet.amount)) {
          betEditedPayload.message =
            NOTIFICATION_TEMPLATE.BET_MODIFIED_INCREASE.MESSAGE({
              amount: editedBet.amount,
            });
          betEditedPayload.title =
            NOTIFICATION_TEMPLATE.BET_MODIFIED_INCREASE.TITLE();
        } else if (Number(oldBettingAmount) > Number(editedBet.amount)) {
          betEditedPayload.message =
            NOTIFICATION_TEMPLATE.BET_MODIFIED_DECREASE.MESSAGE({
              amount: editedBet.amount,
            });
          betEditedPayload.title =
            NOTIFICATION_TEMPLATE.BET_MODIFIED_DECREASE.TITLE();
        }
      }

      // Emit to user's own sockets
      this.server.sockets.sockets.forEach((socket) => {
        const authSocket = socket as AuthenticatedSocket;
        if (authSocket.data?.user?.sub === user.sub) {
          authSocket.emit('betEdited', betEditedPayload);
        }
      });

      // Broadcast updates to all clients
      if (bettingVariable) {
        const updatedBettingVariable =
          await this.bettingService.findBettingVariableById(bettingVariable.id);
        const roundIdEmit =
          updatedBettingVariable.roundId || updatedBettingVariable.round?.id;

        const roundTotals =
          await this.bettingService.getRoundTotals(roundIdEmit);

        let betStat = {};
        if (user.role === UserRole.ADMIN) {
          betStat = await this.bettingService.getBetStatsByStream(
            bettingVariable.stream.id,
          );
        }

        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('bettingUpdate', {
            roundId: roundIdEmit,
            totalBetsSweepCoinAmount: roundTotals.totalBetsSweepCoinAmount,
            totalBetsGoldCoinAmount: roundTotals.totalBetsGoldCoinAmount,
            totalGoldCoinBet: roundTotals.totalGoldCoinBet,
            totalSweepCoinBet: roundTotals.totalSweepCoinBet,
            ...betStat,
          });

        await this.sendPersonalizedPotentialAmounts(
          bettingVariable.stream.id,
          roundIdEmit,
        );

        const chatMessage: ChatMessage = {
          type: 'system',
          username: 'StreambetBot',
          message: `${user.username} edited their bet to ${editedBet.amount} on ${bettingVariable.name}!`,
          timestamp: new Date(),
        };
        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('chatMessage', chatMessage);
      }
    } catch (error) {
      client.emit('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Live chat message handler
   * - Saves chat messages in DB
   * - Emits new message to all users in the stream
   */
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage('sendChatMessage')
  async handleChatMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { streamId: string; message: string; imageURL: string },
  ) {
    const { streamId, message, imageURL } = data;
    const user = client.data.user;

    if (!streamId) {
      return {
        event: 'messageSent',
        data: { success: false, error: 'Stream ID cannot be empty.' },
      };
    }

    const timestamp = new Date();

    try {
      await this.chatService.createChatMessage(
        streamId,
        user.sub,
        message,
        imageURL,
        timestamp,
      );
    } catch (e) {
      return {
        event: 'messageSent',
        data: { success: false, error: e.message },
      };
    }

    const chatMessage: ChatMessage = {
      type: 'user',
      username: user.username,
      message: message.trim(),
      imageURL: imageURL || '',
      timestamp,
      profileUrl: user?.profileImageUrl,
    };

    // Broadcast to all users in stream
    this.server.to(`stream_${streamId}`).emit('newMessage', chatMessage);

    return { event: 'messageSent', data: { success: true } };
  }

  /**
   * Sends a system-generated chat notification to all users connected to a given stream.
   *
   * @param {AuthenticatedSocketPayload} user - The authenticated user triggering the notification.
   * @param {string} streamId - The unique identifier of the stream where the message will be sent.
   * @param {string} systemMessage - The system-generated message to broadcast.
   *
   * @returns {Promise<void>} - Resolves once the system message has been saved and emitted.
   *
   * @description
   * This method performs the following actions:
   * 1. Creates and saves a system chat message in the database via `chatService.createChatMessage`.
   * 2. Constructs a `ChatMessage` object containing system details, including the username,
   *    timestamp, and profile image URL of the user.
   * 3. Emits the `newMessage` event with the constructed `ChatMessage` to all clients in the
   *    WebSocket room `stream_{streamId}`.
   * @description: Reshma
   */
  private async chatNotification(
    user: AuthenticatedSocketPayload,
    streamId: string,
    systemMessage: string,
  ): Promise<void> {
    try {
      const timestamp = new Date();
      try {
        await this.chatService.createChatMessage(
          streamId,
          user.sub,
          undefined,
          undefined,
          timestamp,
          systemMessage,
        );
      } catch (e) {
        Logger.error('Failed to save system chat message:', e.message);
      }
      const systemChatMessage: ChatMessage = {
        type: 'user',
        username: user.username,
        message: '',
        systemMessage,
        imageURL: '',
        timestamp: timestamp,
        profileUrl: user?.profileImageUrl,
      };
      //emmit to all users in a stream - chat
      return void this.server
        .to(`stream_${streamId}`)
        .emit('newMessage', systemChatMessage);
    } catch (e) {
      Logger.error(
        'chatNotification failed',
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /**
   * Emit updated betting stats for a specific variable in a stream.
   * - Sends total bets, counts, and status to all clients in the stream.
   * - Updates personalized potential winnings for each user.
   */
  emitBettingUpdate(streamId: string, bettingVariableId: string): void {
    void this.bettingService
      .findBettingVariableById(bettingVariableId)
      .then(async (bettingVariable) => {
        // Broadcast betting update to stream
        this.server.to(`stream_${streamId}`).emit('bettingUpdate', {
          bettingVariableId: bettingVariable.id,
          totalBetsSweepCoinAmount: bettingVariable.totalBetsSweepCoinAmount,
          totalBetsGoldCoinAmount: bettingVariable.totalBetsGoldCoinAmount,
          betCountSweepCoin: bettingVariable.betCountSweepCoin,
          betCountGoldCoin: bettingVariable.betCountGoldCoin,
          status: bettingVariable.status,
        });

        // Emit personalized potential winnings if roundId exists
        const roundId = bettingVariable.roundId || bettingVariable.round?.id;
        if (roundId) {
          await this.sendPersonalizedPotentialAmounts(streamId, roundId);
        }
      })
      .catch((error) =>
        console.error(
          `Error emitting betting update: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        ),
      );
  }

  /**
   * Emit the declared winner of a betting variable.
   * - Broadcasts winner info to all clients in the stream.
   * - Sends a system chat message announcing the winner.
   */
  emitWinnerDeclared(
    streamId: string,
    bettingVariableId: string,
    winnerName: string,
    winners: { userId: string; username: string }[],
    losers: { userId: string; username: string }[],
    voided: { goldCoin: boolean; sweepCoin: boolean } = {
      goldCoin: false,
      sweepCoin: false,
    },
  ): void {
    this.server.to(`stream_${streamId}`).emit('winnerDeclared', {
      bettingVariableId,
      winnerName,
      winners,
      losers,
      voided,
    });

    // Send system chat message
    const chatMessage: ChatMessage = {
      type: 'system',
      username: 'StreambetBot',
      message: `The winner is: ${winnerName}!`,
      timestamp: new Date(),
    };
    this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);

    Logger.log(`Emitted winner declared to ${streamId}`);
  }

  /**
   * Send a personalized notification to a specific user across all their active sockets.
   */
  sendUserNotification(userId: string, notification: Notification): void {
    const sockets = this.server.sockets.sockets;

    sockets.forEach((socket) => {
      const authSocket = socket as AuthenticatedSocket;
      if (authSocket.data?.user?.sub === userId) {
        authSocket.emit('notification', notification);
      }
    });
  }

  /**
   * Emit betting status changes (open, locked, canceled) for a specific round.
   * - Broadcasts the event to all clients in the stream.
   * - Sends a system chat message describing the status.
   */
  async emitBettingStatus(
    streamId: string,
    roundId: string,
    status: 'open' | 'locked' | 'canceled',
    lockedStatus?: boolean,
  ): Promise<void> {
    let event: string;
    let message: string;
    let payload: any;

    switch (status) {
      case 'open':
        event = 'betOpened';
        message = 'Betting is now open! Bets can be placed.';
        payload = { roundId, open: true };
        break;
      case 'locked':
        event = 'bettingLocked';
        message = 'Betting is now locked! No more bets can be placed.';
        payload = { roundId, lockedStatus };
        break;
      case 'canceled':
        event = 'betCancelledByAdmin';
        message = 'Betting is canceled!';
        payload = { roundId, cancelled: true, message };
        break;
      default:
        throw new Error('Invalid betting status');
    }

    const chatMessage: ChatMessage = {
      type: 'system',
      username: 'StreambetBot',
      message,
      timestamp: new Date(),
    };

    void this.server.to(`stream_${streamId}`).emit(event, payload);
    void this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);
  }

  /**
   * Emit that a stream has ended.
   * - Broadcasts a stream-ended event to all clients.
   * - Sends a system chat message notifying users.
   */
  emitStreamEnd(streamId: string): void {
    const event = 'streamEnded';
    const message = 'Stream has ended!';
    const payload = { streamId, ended: true };

    const chatMessage: ChatMessage = {
      type: 'system',
      username: 'StreambetBot',
      message,
      timestamp: new Date(),
    };

    void this.server.to(`stream_${streamId}`).emit(event, payload);
    void this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);
  }

  /**
   * Emits a "bet open" notification to all users in the 'streambet' room
   * who have in-app notifications enabled.
   *
   * @param roundName - The name of the betting round being opened.
   * @param streamName - The name of the stream where the round is opened.
   */
  async emitOpenBetRound(roundName: string, streamName: string) {
    // Fetch all sockets currently connected to the 'streambet' room
    const sockets = await this.server.in('streambet').fetchSockets();

    // Iterate through each connected socket
    for (const socket of sockets) {
      // Extract user ID from socket data (if available)
      const userId = socket.data?.user?.sub;
      if (!userId) continue; // Skip if user is not authenticated

      // Check if the user has in-app notification permissions enabled
      const receiverNotificationPermission =
        await this.notificationService.addNotificationPermision(userId);

      if (receiverNotificationPermission['inAppNotification']) {
        // Prepare the notification payload using the template
        const payload = {
          type: 'system',
          username: 'StreamBet Bot',
          message: NOTIFICATION_TEMPLATE.BET_OPEN.MESSAGE({
            roundName: roundName || '',
            streamName: streamName || '',
          }),
          title: NOTIFICATION_TEMPLATE.BET_OPEN.TITLE(),
          timestamp: new Date(),
        };

        // Emit the notification directly to this user's socket
        void this.server.to(socket.id).emit('botMessage', payload);

        // Log the emission for debugging/audit purposes
        Logger.log(`Emitted open bet round to 'streambet': ${roundName}`);
      }
    }
  }

  /**
   * Sends personalized potential winning amounts to each user in a stream for a specific round.
   * - Fetches potential amounts for all users from the betting service.
   * - Iterates over all sockets in the stream room.
   * - Emits a `potentialAmountUpdate` event to each user's socket individually.
   */
  private async sendPersonalizedPotentialAmounts(
    streamId: string,
    roundId: string | undefined,
  ): Promise<void> {
    if (!roundId) return;

    try {
      // Fetch potential amounts for all users for this round
      const potentialAmounts =
        await this.bettingService.findPotentialAmountsForAllUsers(roundId);

      // Create a map keyed by userId for faster lookup
      const userPotentialMap = new Map<string, (typeof potentialAmounts)[0]>();
      potentialAmounts.forEach((potential) => {
        userPotentialMap.set(potential.userId, potential);
      });

      // Get all sockets connected to the stream
      const streamRoom = this.server.to(`stream_${streamId}`);
      const sockets = await streamRoom.fetchSockets();

      // Emit personalized potential amounts to each user's socket
      for (const socket of sockets) {
        const userId = (socket as any).data?.user?.sub;

        if (userId && userPotentialMap.has(userId)) {
          const potentialAmount = userPotentialMap.get(userId)!;
          socket.emit('potentialAmountUpdate', {
            bettingVariableId: potentialAmount.bettingVariableId,
            potentialSweepCoinWinningAmount:
              potentialAmount.potentialSweepCoinAmt,
            potentialGoldCoinWinningAmount:
              potentialAmount.potentialGoldCoinAmt,
            currencyType: potentialAmount.currencyType,
            optionName: potentialAmount.optionName,
          });
        }
      }
    } catch (e) {
      console.error('Error sending personalized potential amounts:', e.message);
    }
  }

  /**
   * Public wrapper to trigger personalized potential amount updates for a round.
   * - Finds the round and associated stream.
   * - Calls `sendPersonalizedPotentialAmounts`.
   */
  public async emitPotentialAmountsUpdate(roundId: string): Promise<void> {
    try {
      const round = await this.bettingService[
        'bettingRoundsRepository'
      ].findOne({
        where: { id: roundId },
        relations: ['stream'],
      });
      if (!round || !round.streamId) return;

      await this.sendPersonalizedPotentialAmounts(round.streamId, roundId);
    } catch (e) {
      console.error('Error emitting potential amounts update:', e.message);
    }
  }

  /**
   * Emits a bot message to a specific user notifying them that their bet was canceled by admin.
   * - Checks if the user has in-app notifications enabled.
   * - Sends a `botMessage` event directly to the user's socket.
   */
  async emitBotMessageForCancelBetByAdmin(
    userId: string,
    username: string,
    amount: number,
    currencyType: string,
    bettingOption: string,
    roundName: string,
  ) {
    // Check user's notification permissions
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);

    if (receiverNotificationPermission['inAppNotification']) {
      const socketId = this.userSocketMap.get(username);
      if (!socketId) return;

      // Construct system chat message
      const chatMessage: ChatMessage = {
        type: 'system',
        username: 'StreambetBot',
        message: NOTIFICATION_TEMPLATE.BET_CANCELLED.MESSAGE({
          amount,
          currencyType,
          bettingOption: bettingOption || '',
          roundName: roundName || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_CANCELLED.TITLE(),
        timestamp: new Date(),
      };

      // Send bot message to user's socket
      void this.server.to(socketId).emit('botMessage', chatMessage);
    }
  }
  /**
   * Emit a bot message to a winning user notifying them of their winnings.
   * @param userId - User ID of the winner
   * @param username - Username of the winner
   * @param roundName - Name of the round
   * @param amount - Winning amount
   * @param currencyType - Type of currency won (gold/sweep)
   */
  async emitBotMessageToWinner(
    userId: string,
    username: string,
    roundName: string,
    amount: number,
    currencyType: string,
  ) {
    // Check if user has in-app notification enabled
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);

    if (receiverNotificationPermission['inAppNotification']) {
      const socketId = this.userSocketMap.get(username); // get the socket ID for the user

      // Construct message and title based on currency type
      const message =
        currencyType === CurrencyType.GOLD_COINS
          ? NOTIFICATION_TEMPLATE.BET_WON_GOLD_COIN.MESSAGE({ amount })
          : NOTIFICATION_TEMPLATE.BET_WON_SWEEP_COIN.MESSAGE();

      const title =
        currencyType === CurrencyType.GOLD_COINS
          ? NOTIFICATION_TEMPLATE.BET_WON_GOLD_COIN.TITLE()
          : NOTIFICATION_TEMPLATE.BET_WON_SWEEP_COIN.TITLE();

      const chatMessage: ChatMessage = {
        type: 'system',
        username: 'StreambetBot',
        message,
        title,
        timestamp: new Date(),
      };

      void this.server.to(socketId).emit('botMessage', chatMessage); // send bot message
    }
  }

  /**
   * Emit a bot message to a losing user notifying them of their loss.
   * @param userId - User ID of the loser
   * @param username - Username of the loser
   * @param roundName - Name of the round
   */
  async emitBotMessageToLoser(
    userId: string,
    username: string,
    roundName: string,
  ) {
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);

    if (receiverNotificationPermission['inAppNotification']) {
      const socketId = this.userSocketMap.get(username);

      const chatMessage: ChatMessage = {
        type: 'system',
        username: 'StreambetBot',
        message: NOTIFICATION_TEMPLATE.BET_LOST.MESSAGE({
          roundName: roundName || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_LOST.TITLE(),
        timestamp: new Date(),
      };

      void this.server.to(socketId).emit('botMessage', chatMessage);
    }
  }

  /**
   * Emit a bot message to a user when a winner is declared for a betting option.
   * @param userId - User ID
   * @param username - Username
   * @param bettingOption - Name of the winning betting option
   */
  async emitBotMessageForWinnerDeclaration(
    userId: string,
    username: string,
    bettingOption: string,
  ) {
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);

    if (receiverNotificationPermission['inAppNotification']) {
      const socketId = this.userSocketMap.get(username);

      const chatMessage: ChatMessage = {
        type: 'system',
        username: 'StreambetBot',
        message: NOTIFICATION_TEMPLATE.BET_WINNER_DECLARED.MESSAGE({
          bettingOption: bettingOption || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_WINNER_DECLARED.TITLE(),
        timestamp: new Date(),
      };

      void this.server.to(socketId).emit('botMessage', chatMessage);
    }
  }

  /**
   * Emit a bot message to a user when a betting round is voided.
   * @param userId - User ID
   * @param username - Username
   * @param roundName - Name of the voided round
   */
  async emitBotMessageVoidRound(
    userId: string,
    username: string,
    roundName: string,
  ) {
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);

    if (receiverNotificationPermission['inAppNotification']) {
      const socketId = this.userSocketMap.get(username);

      const chatMessage: ChatMessage = {
        type: 'system',
        username: 'StreambetBot',
        message: NOTIFICATION_TEMPLATE.BET_ROUND_VOID.MESSAGE({
          roundName: roundName || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_ROUND_VOID.TITLE(),
        timestamp: new Date(),
      };

      void this.server.to(socketId).emit('botMessage', chatMessage);
    }
  }

  /**
   * Emit a bot message to a user when a betting round is locked.
   * @param roundName - Name of the betting round being locked
   * @param userId - User ID to send the notification to
   * @param username - Username corresponding to the userId
   */
  async emitLockBetRound(roundName: string, userId: string, username: string) {
    // Check if the user has in-app notification enabled
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);

    if (receiverNotificationPermission['inAppNotification']) {
      const socketId = this.userSocketMap.get(username); // get socket ID for the user

      const chatMessage: ChatMessage = {
        type: 'system', // system message type
        username: 'StreambetBot', // bot username
        message: NOTIFICATION_TEMPLATE.BET_LOCKED.MESSAGE({
          roundName: roundName || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_LOCKED.TITLE(),
        timestamp: new Date(), // current timestamp
      };

      void this.server.to(socketId).emit('botMessage', chatMessage); // send message to the user's socket

      Logger.log(`Emitted betRound to room 'streambet': ${roundName}`); // log for debugging
    }
  }

  /**
   * Emit an event to all clients in the 'streambet' room to update the stream list.
   * @param event - The stream list event type
   */
  emitStreamListEvent(event: StreamList) {
    const payload = { event }; // prepare payload
    this.server.to('streambet').emit('streamListUpdated', payload); // broadcast to all in 'streambet'
    Logger.log(`Emitting stream list event: ${event}`); // log the emission
  }

  /**
   * Emit purchase settled event to all active sockets of a specific user.
   * @param userId - ID of the user
   * @param payload - Data including message, updated wallet balance, and optional coin package
   */
  emitPurchaseSettled(
    userId: string,
    payload: {
      message: string;
      updatedWalletBalance: { goldCoins: number; sweepCoins: number };
      coinPackage?: {
        id: string;
        name: string;
        sweepCoins: number;
        goldCoins: number;
      };
    },
  ): void {
    const sockets = this.server.sockets.sockets;

    // Iterate over all active sockets to find sockets belonging to the user
    sockets.forEach((socket) => {
      const authenticatedSocket = socket as AuthenticatedSocket;
      if (authenticatedSocket.data?.user?.sub === userId) {
        authenticatedSocket.emit('purchaseSettled', payload); // emit purchase settled event
      }
    });
  }

  /**
   * Emits the roundUpdated event to all clients connected to the room stream_{streamId} whenever the admin creates, edits, or deletes round details.
   *
   * @param {string} streamId - The unique identifier of the stream.
   * @param {any} roundDetails - The details of the stream round to be shared with clients.
   *
   * @returns {Promise<void>} - Resolves once the roundUpdated event has been emitted.
   *
   * @description
   * This method constructs a payload containing the `roundDetails` and broadcasts it
   * via WebSocket to all clients subscribed to the room `stream_{streamId}`.
   * The emitted event is named `roundUpdated`.
   *@author: Reshma
   */
  async emitRoundDetails(
    streamId: string,
    streamDetails: StreamDetailsDto,
  ): Promise<void> {
    const payload = { roundDetails: streamDetails.roundDetails };
    void this.server.to(`stream_${streamId}`).emit('roundUpdated', payload);
  }
  /**
   * Emits a socket event to a specific user when an admin adds gold coins.
   *
   * @param userId - The unique identifier of the user to notify.
   *
   * Behavior:
   * - Sends the `SocketEventName.RefechEvent` to the user's socket room (`user_<userId>`).
   * - Client applications can listen to this event to refresh wallet balance or related UI.
   * - Currently sends an empty payload, but can be extended with additional details in the future.
   */
  async emitAdminAddedGoldCoin(userId: string): Promise<void> {
    emitToUser(this.server, userId, SocketEventName.RefetchEvent, {});
  }

  /**
   * Emits a "scheduledStreamUpdatedToLive" event to all clients connected to the stream room.
   *
   * @param streamId - The unique identifier of the stream that has transitioned from scheduled to live.
   *
   * @description
   * Notifies all users in the `stream_{streamId}` room that the scheduled stream is now live.
   * This event can be used by clients to update UI or trigger actions when a stream goes live.
   */
  emitScheduledStreamUpdatedToLive(streamId: string) {
    void this.server
      .to(`stream_${streamId}`)
      .emit('scheduledStreamUpdatedToLive', { streamId });
    Logger.log(
      `Scheduled stream updated to live event triggered to: ${streamId}`,
    );
  }
}
