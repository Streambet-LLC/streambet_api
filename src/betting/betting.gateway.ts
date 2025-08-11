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
import { extractIpFromSocket } from 'src/common/utils/ip-utils';
import { GeoFencingService } from 'src/geo-fencing/geo-fencing.service';

// Define socket with user data
interface AuthenticatedSocket extends Socket {
  data: {
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
  private socketToStreamMap: Map<string, string> = new Map();
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
    private readonly geoFencingService: GeoFencingService,
  ) {}

  // global for all socket events, runs on every incoming connection before any events are handled.
  afterInit() {
    this.server.use(async (socket: any, next: (err?: any) => void) => {
      try {
        const ip = extractIpFromSocket(socket);
        //for debugging, will remove after checking
        console.log(ip, 'ip in socket connection');

        if (!ip) return next(new Error('Could not determine IP'));

        const loc = await this.geoFencingService.lookup(ip);
        socket.data.geo = loc ?? null;

        const blocked = (process.env.BLOCKED_STATE_CODES || '')
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);

        if (
          loc?.country_code &&
          blocked.includes(loc.country_code.toUpperCase())
        ) {
          Logger.log(
            `Socket connection rejected: blocked country ${loc.country_code} ip=${ip}`,
          );
          return next(new Error('geolocation: forbidden'));
        }

        const blockVpn =
          String(process.env.BLOCK_VPN || '').toLowerCase() === 'true';
        if (blockVpn && loc?.isVpn) {
          Logger.log(`Socket connection rejected: VPN ip=${ip}`);
          return next(new Error('geolocation: forbidden'));
        }

        return next();
      } catch (err) {
        Logger.log('Socket geolocation error', String(err));
        return next(new Error('geolocation: error'));
      }
    });
  }
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
      try {
        const { profileImageUrl } = await this.userService.findById(
          decoded.sub,
        );
        const updatedDecode = { ...decoded, profileImageUrl };
        // Explicitly cast to JwtPayload since we've already verified it's not null
        const authenticatedSocket = client as AuthenticatedSocket;
        authenticatedSocket.data = {
          user: updatedDecode,
        };
      } catch (userError) {
        console.error(`Failed to fetch user profile: ${userError.message}`);
        // Still allow connection but without profile image
        const authenticatedSocket = client as AuthenticatedSocket;
        authenticatedSocket.data = {
          user: { ...decoded, profileImageUrl: undefined },
        };
      }

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

  async handleDisconnect(client: Socket): Promise<void> {
    const username = client.data.user?.username;
    if (username) {
      this.userSocketMap.delete(username);
    }
    //live stream viewer count
    const streamId = this.socketToStreamMap.get(client.id);
    if (streamId) {
      try {
        const updatedCount =
          await this.streamService.decrementViewerCount(streamId);
        const roomName = `stream_${streamId}`;
        this.server.to(roomName).emit('viewerCountUpdate', updatedCount);
        Logger.log(
          `Stream ${streamId}: Viewers after disconnect: ${updatedCount}`,
        );
        this.socketToStreamMap.delete(client.id);
      } catch (error) {
        Logger.error(
          `Error updating viewer count on disconnect for stream ${streamId}:`,
          error,
        );
        // Still remove from map to prevent memory leaks
        this.socketToStreamMap.delete(client.id);
      }
    }
    console.log(`${username || client.id} disconnected`);
    Logger.log(`Client disconnected: ${username || client.id}`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('joinStream')
  async handleJoinStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    // If the client was already in a stream, make them leave it first
    //commented -> solving issue for same user place bet in different stream through multiple tab
    /*
    const previousStreamId = this.socketToStreamMap.get(client.id);
    if (previousStreamId && previousStreamId !== streamId) {
      client.leave(`stream_${previousStreamId}`);
      const prevCount =
        await this.streamService.decrementViewerCount(previousStreamId);
      this.server
        .to(`stream_${previousStreamId}`)
        .emit('viewerCountUpdate', prevCount);
      Logger.log(
        `Client ${client.id} left previous stream ${previousStreamId}. New count: ${prevCount}`,
      );
    }
    */
    client.join(`stream_${streamId}`);
    this.server.to(`stream_${streamId}`).emit('joinedStream', { streamId });
    console.log(`User ${client.data.user.username} joined stream ${streamId}`);
    this.socketToStreamMap.set(client.id, streamId);
    // Increment viewer count in DB
    try {
      const updatedCount =
        await this.streamService.incrementViewerCount(streamId);

      // Emit updated count to all clients in this stream's room
      this.server
        .to(`stream_${streamId}`)
        .emit('viewerCountUpdate', updatedCount);
      Logger.log(
        `Client ${client.id} joined stream ${streamId}. Current viewers: ${updatedCount}`,
      );
    } catch (error) {
      Logger.error(
        `Error updating viewer count for stream ${streamId}:`,
        error,
      );
      // Remove from map if database operation failed
      this.socketToStreamMap.delete(client.id);
      throw error;
    }

    // return { event: 'joinedStream', data: { streamId } };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaveStream')
  async handleLeaveStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    const roomName = `stream_${streamId}`;
    if (this.socketToStreamMap.get(client.id) === streamId) {
      client.leave(roomName);
      this.socketToStreamMap.delete(client.id);

      // Decrement viewer count in DB
      const updatedCount =
        await this.streamService.decrementViewerCount(streamId);

      // Emit updated count to all remaining clients in this stream's room
      this.server.to(roomName).emit('viewerCountUpdate', updatedCount);
      Logger.log(
        `Client ${client.id} left stream ${streamId}. Current viewers: ${updatedCount}`,
      );
      return { event: 'leftStream', data: { streamId } };
    } else {
      Logger.warn(
        `Client ${client.id} tried to leave stream ${streamId} but was not registered as viewing it.`,
      );
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('joinStreamBet')
  async handleJoinStreamBet(@ConnectedSocket() client: AuthenticatedSocket) {
    const username = client.data.user.username;
    client.join(`streambet`);
    this.userSocketMap.set(username, client.id);
    this.server.to(`streambet`).emit('joinedStreamBet', { username });
    console.log(`User ${username} joined room  streambet`);
    //  return { event: 'joinedStreamBet', data: { username } };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaveStreamBet')
  async handleLeaveStreamBet(@ConnectedSocket() client: AuthenticatedSocket) {
    const username = client.data.user.username;
    client.leave(`streambet`);
    console.log(`User ${username} left streambet`);
    return { event: 'leaveStreamBet', data: { username } };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('placeBet')
  async handlePlaceBet(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() placeBetDto: PlaceBetDto,
  ) {
    try {
      const user = client.data.user;
      const { bet, roundId } = await this.bettingService.placeBet(
        user.sub,
        placeBetDto,
      );
      const [updatedWallet, bettingVariable] = await Promise.all([
        this.walletsService.findByUserId(user.sub),
        this.bettingService.findBettingVariableById(bet.bettingVariableId),
      ]);
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
      let betPlacePayload: PlaceBetResult = {
        bet,
        success: true,
        currencyType: placeBetDto.currencyType,
        potentialCoinWinningAmount: potentialAmount?.potentialCoinAmt || 0,
        potentialTokenWinningAmount:
          potentialAmount?.potentialFreeTokenAmt || 0,
        amount: placeBetDto.amount,
        selectedWinner: bettingVariable?.name || '',
        updatedWalletBalance: {
          freeTokens: updatedWallet.freeTokens,
          streamCoins: updatedWallet.streamCoins,
        },
      };
      const receiverNotificationPermission =
        await this.notificationService.addNotificationPermision(
          client.data.user.sub,
        );
      if (receiverNotificationPermission['inAppNotification']) {
        betPlacePayload.message = NOTIFICATION_TEMPLATE.BET_PLACED.MESSAGE({
          amount: placeBetDto.amount,
          currencyType: placeBetDto.currencyType,
          bettingOption: bettingVariable?.name || '',
          roundName: bettingVariable.round.roundName || '',
        });
        betPlacePayload.title = NOTIFICATION_TEMPLATE.BET_PLACED.TITLE();
      }
      // Emit placement confirmation only to the user's own active sockets
      this.server.sockets.sockets.forEach((socket) => {
        const authenticatedSocket = socket as AuthenticatedSocket;
        if (authenticatedSocket.data?.user?.sub === user.sub) {
          authenticatedSocket.emit('betPlaced', betPlacePayload);
        }
      });
      // Emit to all clients after DB commit
      if (bettingVariable) {
        const updatedBettingVariable =
          await this.bettingService.findBettingVariableById(bettingVariable.id);
        const roundIdEmit =
          updatedBettingVariable.roundId || updatedBettingVariable.round?.id;
        const roundTotals =
          await this.bettingService.getRoundTotals(roundIdEmit);
        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('bettingUpdate', {
            roundId: roundIdEmit,
            totalBetsCoinAmount: roundTotals.totalBetsCoinAmount,
            totalBetsTokenAmount: roundTotals.totalBetsTokenAmount,
          });
        await this.sendPersonalizedPotentialAmounts(
          bettingVariable.stream.id,
          roundIdEmit,
        );
        const chatMessage: ChatMessage = {
          type: 'system',
          username: 'StreambetBot',
          message: `${user.username} placed a bet of ${bet.amount} on ${bettingVariable.name}!`,
          timestamp: new Date(),
        };
        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('chatMessage', chatMessage);
        const timestamp = new Date();
        const systemMessage =
          NOTIFICATION_TEMPLATE.PLACE_BET_CHAT_MESSAGE.MESSAGE({
            username: user.username,
            amount: bet.amount,
            bettingOption: bettingVariable.name,
          });
        try {
          await this.chatService.createChatMessage(
            bettingVariable.stream.id,
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
        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('newMessage', systemChatMessage);
      }
    } catch (error) {
      void client.emit('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  @UseGuards(WsJwtGuard)
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
          freeTokens: updatedWallet.freeTokens,
          streamCoins: updatedWallet.streamCoins,
        },
      };
      const receiverNotificationPermission =
        await this.notificationService.addNotificationPermision(
          client.data.user.sub,
        );
      if (receiverNotificationPermission['inAppNotification']) {
        betCancelPayout.message = NOTIFICATION_TEMPLATE.BET_CANCELLED.MESSAGE({
          amount: bet.amount,
          currencyType: bet.currency,
          bettingOption: bettingVariable?.name || '',
          roundName: bettingVariable.round.roundName || '',
        });
        betCancelPayout.title = NOTIFICATION_TEMPLATE.BET_CANCELLED.TITLE();
      }
      // Emit cancellation confirmation only to the user's own active sockets
      this.server.sockets.sockets.forEach((socket) => {
        const authenticatedSocket = socket as AuthenticatedSocket;
        if (authenticatedSocket.data?.user?.sub === user.sub) {
          authenticatedSocket.emit('betCancelled', betCancelPayout);
        }
      });

      // Emit to all clients after DB commit
      if (bettingVariable) {
        const updatedBettingVariable =
          await this.bettingService.findBettingVariableById(bettingVariable.id);
        const roundIdEmit =
          updatedBettingVariable.roundId || updatedBettingVariable.round?.id;
        const roundTotals =
          await this.bettingService.getRoundTotals(roundIdEmit);
        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('bettingUpdate', {
            roundId: roundIdEmit,
            totalBetsCoinAmount: roundTotals.totalBetsCoinAmount,
            totalBetsTokenAmount: roundTotals.totalBetsTokenAmount,
          });
        await this.sendPersonalizedPotentialAmounts(
          bettingVariable.stream.id,
          roundIdEmit,
        );
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

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('editBet')
  async handleEditBet(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() editBetDto: EditBetDto,
  ) {
    try {
      const user = client.data.user;
      const editedBet = await this.bettingService.editBet(user.sub, editBetDto);
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
      let betEditedPayload: EditedBetPayload = {
        bet: editedBet,
        success: true,
        timestamp: new Date(),
        currencyType: editedBet.currency,
        potentialCoinWinningAmount: potentialAmount?.potentialCoinAmt || 0,
        potentialTokenWinningAmount:
          potentialAmount?.potentialFreeTokenAmt || 0,
        amount: editedBet.amount,
        selectedWinner: bettingVariable?.name || '',
        updatedWalletBalance: {
          freeTokens: updatedWallet.freeTokens,
          streamCoins: updatedWallet.streamCoins,
        },
      };
      const receiverNotificationPermission =
        await this.notificationService.addNotificationPermision(
          client.data.user.sub,
        );
      if (receiverNotificationPermission['inAppNotification']) {
        betEditedPayload.message = NOTIFICATION_TEMPLATE.BET_EDIT.MESSAGE({
          amount: editedBet.amount,
          currencyType: editedBet.currency,
          bettingOption: bettingVariable?.name || '',
          roundName: bettingVariable.round.roundName || '',
        });
        betEditedPayload.title = NOTIFICATION_TEMPLATE.BET_EDIT.TITLE();
      }

      // Emit edit confirmation only to the user's own active sockets
      this.server.sockets.sockets.forEach((socket) => {
        const authenticatedSocket = socket as AuthenticatedSocket;
        if (authenticatedSocket.data?.user?.sub === user.sub) {
          authenticatedSocket.emit('betEdited', betEditedPayload);
        }
      });
      // Emit to all clients after DB commit
      if (bettingVariable) {
        // Refetch the latest betting round with variables
        const updatedBettingVariable =
          await this.bettingService.findBettingVariableById(bettingVariable.id);
        const roundIdEmit =
          updatedBettingVariable.roundId || updatedBettingVariable.round?.id;
        const updatedRound = await this.bettingService[
          'bettingRoundsRepository'
        ].findOne({
          where: { id: roundIdEmit },
          relations: ['bettingVariables'],
        });
        const roundTotals =
          await this.bettingService.getRoundTotals(roundIdEmit);
        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('bettingUpdate', {
            roundId: roundIdEmit,
            totalBetsCoinAmount: roundTotals.totalBetsCoinAmount,
            totalBetsTokenAmount: roundTotals.totalBetsTokenAmount,
          });
        // Use the latest round for personalized potential amounts
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
  //live chat implementation
  @UseGuards(WsJwtGuard)
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
        data: {
          success: false,
          error: 'Stream ID  cannot be empty.',
        },
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
      timestamp: timestamp,
      profileUrl: user?.profileImageUrl,
    };
    this.server.to(`stream_${streamId}`).emit('newMessage', chatMessage);
    return { event: 'messageSent', data: { success: true } };
  }

  emitBettingUpdate(streamId: string, bettingVariableId: string): void {
    void this.bettingService
      .findBettingVariableById(bettingVariableId)
      .then(async (bettingVariable) => {
        this.server.to(`stream_${streamId}`).emit('bettingUpdate', {
          bettingVariableId: bettingVariable.id,
          totalBetsCoinAmount: bettingVariable.totalBetsCoinAmount,
          totalBetsTokenAmount: bettingVariable.totalBetsTokenAmount,
          betCountCoin: bettingVariable.betCountCoin,
          betCountFreeToken: bettingVariable.betCountFreeToken,
          status: bettingVariable.status,
        });

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

  emitWinnerDeclared(
    streamId: string,
    bettingVariableId: string,
    winnerName: string,
    winners: { userId: string; username: string }[],
  ): void {
    this.server.to(`stream_${streamId}`).emit('winnerDeclared', {
      bettingVariableId,
      winnerName,
      winners,
    });

    const chatMessage: ChatMessage = {
      type: 'system',
      username: 'StreambetBot',
      message: `The winner is: ${winnerName}!`,
      timestamp: new Date(),
    };

    this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);
  }

  sendUserNotification(userId: string, notification: Notification): void {
    const sockets = this.server.sockets.sockets;

    sockets.forEach((socket) => {
      const authenticatedSocket = socket as AuthenticatedSocket;
      if (authenticatedSocket.data?.user?.sub === userId) {
        authenticatedSocket.emit('notification', notification);
      }
    });
  }

  async emitBettingStatus(
    streamId: string,
    roundId: string,
    status: 'open' | 'locked' | 'canceled',
    lockedStatus?: Boolean,
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

  private async sendPersonalizedPotentialAmounts(
    streamId: string,
    roundId: string | undefined,
  ): Promise<void> {
    if (roundId) {
      try {
        const potentialAmounts =
          await this.bettingService.findPotentialAmountsForAllUsers(roundId);

        // Create a map for faster user lookup
        const userPotentialMap = new Map();
        potentialAmounts.forEach((potential) => {
          userPotentialMap.set(potential.userId, potential);
        });

        // Get all sockets in the stream room and send personalized updates
        const streamRoom = this.server.to(`stream_${streamId}`);
        const sockets = await streamRoom.fetchSockets();

        for (const socket of sockets) {
          const userId = (socket as any).data?.user?.sub;

          if (userId && userPotentialMap.has(userId)) {
            const potentialAmount = userPotentialMap.get(userId);
            socket.emit('potentialAmountUpdate', {
              bettingVariableId: potentialAmount.bettingVariableId,
              potentialCoinWinningAmount: potentialAmount.potentialCoinAmt,
              potentialTokenWinningAmount:
                potentialAmount.potentialFreeTokenAmt,
              currencyType: potentialAmount.currencyType,
              optionName: potentialAmount.optionName,
            });
          }
        }
      } catch (e) {
        console.error(
          'Error sending personalized potential amounts:',
          e.message,
        );
      }
    }
  }

  public async emitPotentialAmountsUpdate(roundId: string): Promise<void> {
    try {
      // Find the round and its stream
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
  async emitBotMessageForCancelBetByAdmin(
    userId: string,
    username: string,
    amount: number,
    currencyType: string,
    bettingOption: string,
    roundName: string,
  ) {
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);
    if (receiverNotificationPermission['inAppNotification']) {
      const socketId = this.userSocketMap.get(username);
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
      void this.server.to(socketId).emit('botMessage', chatMessage);
    }
  }
  async emitBotMessageToWinner(
    userId: string,
    username: string,
    roundName: string,
    amount: number,
    currencyType: string,
  ) {
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);
    if (receiverNotificationPermission['inAppNotification']) {
      const socketId = this.userSocketMap.get(username);

      const chatMessage: ChatMessage = {
        type: 'system',
        username: 'StreambetBot',
        message: NOTIFICATION_TEMPLATE.BET_WON.MESSAGE({
          amount: amount,
          currencyType: currencyType,
          roundName: roundName || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_WON.TITLE(),
        timestamp: new Date(),
      };
      void this.server.to(socketId).emit('botMessage', chatMessage);
    }
  }
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

  async emitOpenBetRound(roundName: string, streamName: string) {
    const sockets = await this.server.in('streambet').fetchSockets();
    for (const socket of sockets) {
      const userId = socket.data?.user?.sub;
      if (!userId) continue;
      const username = socket.data.user?.username;
      const receiverNotificationPermission =
        await this.notificationService.addNotificationPermision(userId);
      if (receiverNotificationPermission['inAppNotification']) {
        const socketId = this.userSocketMap.get(username);
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
        void this.server.to(socketId).emit('botMessage', payload);
        Logger.log(`Emitted betRound to room 'streambet': ${roundName}`);
      }
    }
  }

  async emitLockBetRound(roundName: string, userId: string, username: string) {
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);

    if (receiverNotificationPermission['inAppNotification']) {
      const socketId = this.userSocketMap.get(username);
      const chatMessage: ChatMessage = {
        type: 'system',
        username: 'StreambetBot',
        message: NOTIFICATION_TEMPLATE.BET_LOCKED.MESSAGE({
          roundName: roundName || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_LOCKED.TITLE(),
        timestamp: new Date(),
      };

      void this.server.to(socketId).emit('botMessage', chatMessage);

      Logger.log(`Emitted betRound to room 'streambet': ${roundName}`);
    }
  }

  emitStreamListEvent(event: StreamList) {
    const payload = { event };
    this.server.to('streambet').emit('streamListUpdated', payload);
    Logger.log(`Emitting stream list event: ${event}`);
  }
}
