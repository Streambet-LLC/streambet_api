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

// Define betting operation types
type BettingOperation = 'placed' | 'cancelled' | 'edited';

// Define background operation context
interface BackgroundOperationContext {
  user: JwtPayload;
  bettingVariable: any;
  operation: BettingOperation;
  amount?: number;
  streamId: string;
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
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.disconnect();
        return;
      }

      const decoded = this.authService.verifyRefreshToken(token);
      if (!decoded) {
        client.disconnect();
        return;
      }

      const authenticatedSocket = client as AuthenticatedSocket;
      authenticatedSocket.data = { user: decoded };

      console.log(
        `Client connected: ${client.id}, user: ${decoded.username || 'unknown'}`,
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
    client.join(`stream_${streamId}`);
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
      const user = client.data.user;
      const bet = await this.bettingService.placeBet(user.sub, placeBetDto);

      const { bettingVariable, roundTotals, potentialAmount } =
        await this.getBettingData(bet.bettingVariableId, user.sub);

      const response = this.buildBetResponse('placed', {
        bet,
        currencyType: placeBetDto.currencyType,
        amount: placeBetDto.amount,
        selectedWinner: bettingVariable?.name || '',
        potentialAmount,
        roundTotals,
      });

      client.emit('betPlaced', response);

      // Run background operations
      this.runBackgroundOperations({
        user,
        bettingVariable,
        operation: 'placed',
        amount: placeBetDto.amount,
        streamId: bettingVariable?.stream?.id,
      });
    } catch (error) {
      this.handleError(client, error);
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
      const { updatedWallet, bettingVariable } =
        await this.getWalletAndBettingVariable(user.sub, bet.bettingVariableId);

      client.emit('betCancelled', {
        bet,
        success: true,
        updatedWalletBalance: {
          freeTokens: updatedWallet.freeTokens,
          streamCoins: updatedWallet.streamCoins,
        },
      });

      // Run background operations
      this.runBackgroundOperations({
        user,
        bettingVariable,
        operation: 'cancelled',
        amount: bet.amount,
        streamId: bettingVariable?.stream?.id,
      });
    } catch (error) {
      this.handleError(client, error);
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

      const { bettingVariable, roundTotals, potentialAmount } =
        await this.getBettingData(editedBet.bettingVariableId, user.sub);

      const response = this.buildBetResponse('edited', {
        bet: editedBet,
        currencyType: editBetDto.newCurrencyType,
        amount: editBetDto.newAmount,
        selectedWinner: bettingVariable?.name || '',
        potentialAmount,
        roundTotals,
      });

      client.emit('betEdited', response);

      // Run background operations
      this.runBackgroundOperations({
        user,
        bettingVariable,
        operation: 'edited',
        amount: editedBet.amount,
        streamId: bettingVariable?.stream?.id,
      });
    } catch (error) {
      this.handleError(client, error);
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

    const chatMessage: ChatMessage = {
      type: 'user',
      username: user.username,
      message,
      timestamp: new Date(),
    };

    this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);
    return { event: 'messageSent', data: { success: true } };
  }

  emitBettingUpdate(streamId: string, bettingVariableId: string): void {
    void this.bettingService
      .findBettingVariableById(bettingVariableId)
      .then(async (bettingVariable) => {
        const roundId = bettingVariable.roundId || bettingVariable.round?.id;
        let roundTotals = { totalCoinAmount: 0, totalTokenAmount: 0 };

        if (roundId) {
          try {
            roundTotals =
              await this.bettingService.getRoundTotalAmounts(roundId);
          } catch (e) {
            console.error('Error getting round totals:', e.message);
          }
        }

        this.server.to(`stream_${streamId}`).emit('bettingUpdate', {
          bettingVariableId: bettingVariable.id,
          totalBetsCoinAmount: roundTotals.totalCoinAmount,
          totalBetsTokenAmount: roundTotals.totalTokenAmount,
          betCountCoin: bettingVariable.betCountCoin,
          betCountFreeToken: bettingVariable.betCountFreeToken,
          status: bettingVariable.status,
        });

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

    this.emitSystemChatMessage(streamId, `The winner is: ${winnerName}!`);
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

  emitBettingStatus(
    streamId: string,
    roundId: string,
    status: 'open' | 'locked' | 'canceled',
  ): void {
    const statusConfig = {
      open: {
        event: 'betOpened',
        message: 'Betting is now open! Bets can be placed.',
      },
      locked: {
        event: 'bettingLocked',
        message: 'Betting is now locked! No more bets can be placed.',
      },
      canceled: {
        event: 'betCancelledByAdmin',
        message: 'Betting is canceled!',
      },
    };

    const config = statusConfig[status];
    if (!config) {
      throw new Error('Invalid betting status');
    }

    const payload = { roundId, [status]: true };
    this.server.to(`stream_${streamId}`).emit(config.event, payload);
    this.emitSystemChatMessage(streamId, config.message);
  }

  emitStreamEnd(streamId: string): void {
    const payload = { streamId, ended: true };
    this.server.to(`stream_${streamId}`).emit('streamEnded', payload);
    this.emitSystemChatMessage(streamId, 'Stream has ended!');
  }

  // Private helper methods
  private extractToken(client: Socket): string | null {
    return (
      client.handshake.auth.token ||
      client.handshake.headers.authorization?.split(' ')[1] ||
      null
    );
  }

  private async getBettingData(bettingVariableId: string, userId: string) {
    const [bettingVariable, roundTotals] = await Promise.all([
      this.bettingService.findBettingVariableById(bettingVariableId),
      this.getRoundTotals(bettingVariableId),
    ]);

    const roundId = bettingVariable?.roundId || bettingVariable?.round?.id;
    let potentialAmount = null;

    if (roundId) {
      try {
        potentialAmount = await this.bettingService.findPotentialAmount(
          userId,
          roundId,
        );
      } catch (e) {
        console.error('Potential amount error:', e.message);
      }
    }

    return { bettingVariable, roundTotals, potentialAmount };
  }

  private async getWalletAndBettingVariable(
    userId: string,
    bettingVariableId: string,
  ) {
    const [updatedWallet, bettingVariable] = await Promise.all([
      this.walletsService.findByUserId(userId),
      this.bettingService.findBettingVariableById(bettingVariableId),
    ]);

    return { updatedWallet, bettingVariable };
  }

  private async getRoundTotals(bettingVariableId: string) {
    try {
      const bettingVariable =
        await this.bettingService.findBettingVariableById(bettingVariableId);
      const roundId = bettingVariable?.roundId || bettingVariable?.round?.id;

      return roundId
        ? await this.bettingService.getRoundTotalAmounts(roundId)
        : { totalCoinAmount: 0, totalTokenAmount: 0 };
    } catch (e) {
      console.error('Error getting round totals:', e.message);
      return { totalCoinAmount: 0, totalTokenAmount: 0 };
    }
  }

  private buildBetResponse(operation: BettingOperation, data: any) {
    const baseResponse = {
      success: true,
      currencyType: data.currencyType,
      potentialCoinWinningAmount: data.potentialAmount?.potentialCoinAmt || 0,
      potentialTokenWinningAmount:
        data.potentialAmount?.potentialFreeTokenAmt || 0,
      amount: data.amount,
      selectedWinner: data.selectedWinner,
      roundTotals: {
        totalCoinAmount: data.roundTotals.totalCoinAmount,
        totalTokenAmount: data.roundTotals.totalTokenAmount,
      },
    };

    if (operation === 'placed') {
      return { bet: data.bet, ...baseResponse };
    } else if (operation === 'edited') {
      return { editedBet: data.bet, ...baseResponse };
    }

    return baseResponse;
  }

  private runBackgroundOperations(context: BackgroundOperationContext): void {
    void (async () => {
      try {
        if (context.bettingVariable) {
          this.emitBettingUpdate(context.streamId, context.bettingVariable.id);
          this.emitSystemChatMessage(
            context.streamId,
            this.buildChatMessage(context),
          );
        }
      } catch (e) {
        console.error(
          `Error in background ${context.operation} operations:`,
          e.message,
        );
      }
    })();
  }

  private buildChatMessage(context: BackgroundOperationContext): string {
    const { user, bettingVariable, operation, amount } = context;

    switch (operation) {
      case 'placed':
        return `${user.username} placed a bet of ${amount} on ${bettingVariable.name}!`;
      case 'cancelled':
        return `${user.username} cancelled their bet of ${amount} on ${bettingVariable.name}!`;
      case 'edited':
        return `${user.username} edited their bet to ${amount} on ${bettingVariable.name}!`;
      default:
        return `${user.username} performed a betting operation!`;
    }
  }

  private emitSystemChatMessage(streamId: string, message: string): void {
    const chatMessage: ChatMessage = {
      type: 'system',
      username: 'StreambetBot',
      message,
      timestamp: new Date(),
    };
    this.server.to(`stream_${streamId}`).emit('chatMessage', chatMessage);
  }

  private handleError(client: AuthenticatedSocket, error: any): void {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('Gateway error:', errorMessage);
    client.emit('error', { message: errorMessage });
  }

  private async sendPersonalizedPotentialAmounts(
    streamId: string,
    roundId: string | undefined,
  ): Promise<void> {
    if (!roundId) return;

    try {
      const potentialAmounts =
        await this.bettingService.findPotentialAmountsForAllUsers(roundId);
      const userPotentialMap = new Map();

      potentialAmounts.forEach((potential) => {
        userPotentialMap.set(potential.userId, potential);
      });

      const streamRoom = this.server.to(`stream_${streamId}`);
      const sockets = await streamRoom.fetchSockets();

      for (const socket of sockets) {
        const userId = (socket as any).data?.user?.sub;
        if (userId && userPotentialMap.has(userId)) {
          const potentialAmount = userPotentialMap.get(userId);
          socket.emit('potentialAmountUpdate', {
            bettingVariableId: potentialAmount.bettingVariableId,
            potentialCoinWinningAmount: potentialAmount.potentialCoinAmt,
            potentialTokenWinningAmount: potentialAmount.potentialFreeTokenAmt,
            currencyType: potentialAmount.currencyType,
            optionName: potentialAmount.optionName,
          });
        }
      }
    } catch (e) {
      console.error('Error sending personalized potential amounts:', e.message);
    }
  }
}
