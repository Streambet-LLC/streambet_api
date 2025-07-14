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
import { UseGuards, Inject, forwardRef } from '@nestjs/common';
import { BettingService } from './betting.service';
import { PlaceBetDto, EditBetDto } from './dto/place-bet.dto';
import { CancelBetDto } from './dto/cancel-bet.dto';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { AuthService } from '../auth/auth.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrencyType } from '../wallets/entities/transaction.entity';
import { WalletsService } from '../wallets/wallets.service';
import { StreamService } from 'src/stream/stream.service';
import { NOTIFICATION_TEMPLATE } from 'src/notification/notification.templates';

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
  imageURL?: string;
  title?: string;
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

  constructor(
    @Inject(forwardRef(() => BettingService))
    private readonly bettingService: BettingService,
    private readonly authService: AuthService,
    private readonly walletsService: WalletsService,
    private readonly streamService: StreamService,
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

  async handleDisconnect(client: Socket): Promise<void> {
    console.log(`Client disconnected: ${client.id}`);
  }

  //@UseGuards(WsJwtGuard)
  // @SubscribeMessage('test')
  // testStream(
  //   @ConnectedSocket() client: AuthenticatedSocket,
  //   @MessageBody() message: string,
  // ) {
  //   console.log({ message });
  //   // Join the stream's room
  //   client.join(`stream`);

  //   // Let the client know they joined successfully
  //   client.emit('joinedStream', { time: new Date() });

  //   console.log(`User ${client.data.user.username} joined stream`);

  //   return { event: 'joinedStream', data: { time: new Date() } };
  // }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('joinStream')
  async handleJoinStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    // Join the stream's room
    client.join(`stream_${streamId}`);

    // Let the client know they joined successfully
    client.emit('joinedStream', { streamId });

    console.log(`User ${client.data.user.username} joined stream ${streamId}`);
    try {
      await this.streamService.incrementViewCount(streamId);
    } catch (error) {
      console.error(
        `Failed to increment view count for stream ${streamId}:`,
        error,
      );
    }

    return { event: 'joinedStream', data: { streamId } };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaveStream')
  async handleLeaveStream(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    // Leave the stream's room
    client.leave(`stream_${streamId}`);

    console.log(`User ${client.data.user.username} left stream ${streamId}`);
    try {
      await this.streamService.decrementViewCount(streamId);
    } catch (error) {
      console.error(
        `Failed to decrement view count for stream ${streamId}:`,
        error,
      );
    }

    return { event: 'leftStream', data: { streamId } };
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

      client.emit('betPlaced', {
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
          message: NOTIFICATION_TEMPLATE.BET_PLACED.MESSAGE({
            amount: placeBetDto.amount,
            currencyType: placeBetDto.currencyType,
            bettingOption: bettingVariable?.name || '',
            roundName: bettingVariable.round.roundName || '',
          }),
          title: NOTIFICATION_TEMPLATE.BET_PLACED.TITLE(),
          timestamp: new Date(),
        };
        this.server
          .to(`stream_${bettingVariable.stream.id}`)
          .emit('chatMessage', chatMessage);
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
      client.emit('betCancelled', {
        bet,
        success: true,
        updatedWalletBalance: {
          freeTokens: updatedWallet.freeTokens,
          streamCoins: updatedWallet.streamCoins,
        },
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
          message: NOTIFICATION_TEMPLATE.BET_CANCELLED.MESSAGE({
            amount: bet.amount,
            currencyType: bet.currency,
            bettingOption: bettingVariable?.name || '',
            roundName: bettingVariable.round.roundName || '',
          }),
          title: NOTIFICATION_TEMPLATE.BET_CANCELLED.TITLE(),
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
      client.emit('betEdited', {
        bet: editedBet,
        success: true,
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
          message: NOTIFICATION_TEMPLATE.BET_EDIT.MESSAGE({
            amount: editedBet.amount,
            currencyType: editedBet.currency,
            bettingOption: bettingVariable?.name || '',
            roundName: bettingVariable.round.roundName || '',
          }),
          title: NOTIFICATION_TEMPLATE.BET_EDIT.TITLE(),
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
  handleChatMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { streamId: string; message: string; imageURL: string },
  ) {
    const { streamId, message, imageURL } = data;
    const user = client.data.user;
    if (!streamId || !message || !streamId.trim() || !message.trim()) {
      return {
        event: 'messageSent',
        data: {
          success: false,
          error: 'Stream ID and message cannot be empty.',
        },
      };
    }

    const chatMessage: ChatMessage = {
      type: 'user',
      username: user.username,
      message: message.trim(),
      imageURL: imageURL || '',
      timestamp: new Date(),
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
        payload = { roundId, cancelled: true };
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
}
