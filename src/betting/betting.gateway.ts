import { forwardRef, Inject, Logger, UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { GeoFencingSocketGuard } from 'src/auth/guards/geo-fencing-socket.guard';
import { WsJwtGuard } from 'src/auth/guards/ws-jwt.guard';
import {
  emitToClient,
  emitToSocket,
  emitToStream,
  emitToStreamBet,
  emitToUser,
} from 'src/common/common';
import { STREAMBET } from 'src/common/constants/ws.constants';
import { ChatType, SocketEventName } from 'src/enums/socket.enum';
import { AuthenticatedSocket } from 'src/interface/socket.interface';
import { AppGateway } from 'src/ws/app.gateway';
import { GatewayManager } from 'src/ws/gateway.manager';
import { EditBetDto, PlaceBetDto } from './dto/place-bet.dto';
import { WalletsService } from 'src/wallets/wallets.service';
import { NotificationService } from 'src/notification/notification.service';
import { BettingService } from './betting.service';
import { PlaceBetResult } from 'src/interface/betPlace.interface';
import { NOTIFICATION_TEMPLATE } from 'src/notification/notification.templates';
import { UserRole } from 'src/users/entities/user.entity';
import { ChatMessage } from 'src/interface/chat-message.interface';
import { ChatGateway } from 'src/chat/chat.gateway';
import { CurrencyType } from 'src/wallets/entities/transaction.entity';
import { CancelBetDto } from './dto/cancel-bet.dto';
import { CancelBetPayout } from 'src/interface/betCancel.interface';
import { EditedBetPayload } from 'src/interface/betEdit.interface';
import { BettingRoundStatus } from 'src/enums/round-status.enum';

@WebSocketGateway()
export class BettingGateway {
  private readonly logger = new Logger(BettingGateway.name);

  constructor(
    private readonly gatewayManager: GatewayManager,
    @Inject(forwardRef(() => AppGateway))
    private readonly appGateway: AppGateway,
    @Inject(forwardRef(() => BettingService))
    private readonly bettingService: BettingService,
    private readonly walletsService: WalletsService,
    private readonly notificationService: NotificationService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage(SocketEventName.JoinStreamBet)
  async handleJoinStreamBet(@ConnectedSocket() client: AuthenticatedSocket) {
    const userId = client.data.user.sub;
    const username = client.data.user.username;
    client.join(STREAMBET); // join common betting room

    // Check if user already has a set of socket IDs
    if (!this.appGateway.userSocketMap.has(userId)) {
      this.appGateway.userSocketMap.set(userId, new Set());
    }

    // Add this socket ID to the set
    this.appGateway.userSocketMap.get(userId)!.add(client.id);

    // Notify all users in 'streambet' room
    void emitToStreamBet(this.gatewayManager, SocketEventName.JoinedStreamBet, {
      username,
    });

    this.logger.log(`User ${username} joined room streambet`);
  }

  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage(SocketEventName.LeaveStreamBet)
  async handleLeaveStreamBet(@ConnectedSocket() client: AuthenticatedSocket) {
    const username = client.data.user.username;
    client.leave(STREAMBET); // leave the betting room

    this.logger.log(`User ${username} left streambet`);

    // Notify the client or log for reference
    return { event: SocketEventName.LeaveStreamBet, data: { username } };
  }
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage(SocketEventName.PlaceBet)
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
      emitToUser(
        this.gatewayManager,
        user.sub,
        SocketEventName.BetPlaced,
        betPlacePayload,
      );
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
        void emitToStream(
          this.gatewayManager,
          bettingVariable.stream.id,
          SocketEventName.BettingUpdate,
          {
            roundId: roundIdEmit,
            totalBetsSweepCoinAmount: roundTotals.totalBetsSweepCoinAmount,
            totalBetsGoldCoinAmount: roundTotals.totalBetsGoldCoinAmount,
            totalSweepCoinBet: roundTotals.totalSweepCoinBet,
            totalGoldCoinBet: roundTotals.totalGoldCoinBet,
            ...betStat,
          },
        );

        // Personalized potential amounts for all users
        await this.sendPersonalizedPotentialAmounts(
          bettingVariable.stream.id,
          roundIdEmit,
        );

        // System chat notification for bet placement
        const chatMessage: ChatMessage = {
          type: ChatType.System,
          username: ChatType.StreambetBot,
          message: `${user.username} placed a bet of ${bet.amount} on ${bettingVariable.name}!`,
          timestamp: new Date(),
        };
        void emitToStream(
          this.gatewayManager,
          bettingVariable.stream.id,
          SocketEventName.ChatMessage,
          chatMessage,
        );

        // Send optional chat notifications via service
        const systemMessage =
          NOTIFICATION_TEMPLATE.PLACE_BET_CHAT_MESSAGE.MESSAGE({
            username: user.username,
            amount: bet.amount,
            bettingOption: bettingVariable.name,
          });
        await this.chatGateway.chatNotification(
          user,
          bettingVariable.stream.id,
          systemMessage,
        );
      }
    } catch (error) {
      emitToClient(client, SocketEventName.Error, {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

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
      const server = await this.gatewayManager.getServer();
      const streamRoom = server.to(`stream_${streamId}`);
      const sockets = await streamRoom.fetchSockets();

      // Emit personalized potential amounts to each user's socket
      for (const socket of sockets) {
        const userId = (socket as any).data?.user?.sub;

        if (userId && userPotentialMap.has(userId)) {
          const potentialAmount = userPotentialMap.get(userId)!;
          socket.emit(SocketEventName.PotentialAmountUpdate, {
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
      const socketId = this.gatewayManager.getSocketIds(userId);
      if (!socketId) return;

      // Construct system chat message
      const chatMessage: ChatMessage = {
        type: ChatType.System,
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
      const socketIds = Array.from(
        this.appGateway.userSocketMap.get(username) ?? [],
      );
      emitToSocket(
        this.gatewayManager,
        socketIds,
        SocketEventName.BotMessage,
        chatMessage,
      );
    }
  }
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage(SocketEventName.CancelBet)
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
      const server = await this.gatewayManager.getServer();
      server.sockets.sockets.forEach((socket) => {
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
        void emitToStream(
          this.gatewayManager,
          bettingVariable.stream.id,
          SocketEventName.BettingUpdate,
          {
            roundId: roundIdEmit,
            totalBetsSweepCoinAmount: roundTotals.totalBetsSweepCoinAmount,
            totalBetsGoldCoinAmount: roundTotals.totalBetsGoldCoinAmount,
            totalSweepCoinBet: roundTotals.totalSweepCoinBet,
            totalGoldCoinBet: roundTotals.totalGoldCoinBet,
            ...betStat,
          },
        );

        await this.sendPersonalizedPotentialAmounts(
          bettingVariable.stream.id,
          roundIdEmit,
        );

        // System chat message
        const chatMessage: ChatMessage = {
          type: ChatType.System,
          username: ChatType.StreambetBot,
          message: `${user.username} cancelled their bet of ${bet.amount} on ${bettingVariable.name}!`,
          timestamp: new Date(),
        };
        void emitToStream(
          this.gatewayManager,
          bettingVariable.stream.id,
          SocketEventName.ChatMessage,
          chatMessage,
        );
      }
    } catch (error) {
      client.emit('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  @UseGuards(WsJwtGuard, GeoFencingSocketGuard)
  @SubscribeMessage(SocketEventName.EditBet)
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
      emitToUser(
        this.gatewayManager,
        user.sub,
        SocketEventName.BetEdited,
        betEditedPayload,
      );

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
        void emitToStream(
          this.gatewayManager,
          bettingVariable.stream.id,
          SocketEventName.BettingUpdate,
          {
            roundId: roundIdEmit,
            totalBetsSweepCoinAmount: roundTotals.totalBetsSweepCoinAmount,
            totalBetsGoldCoinAmount: roundTotals.totalBetsGoldCoinAmount,
            totalGoldCoinBet: roundTotals.totalGoldCoinBet,
            totalSweepCoinBet: roundTotals.totalSweepCoinBet,
            ...betStat,
          },
        );

        await this.sendPersonalizedPotentialAmounts(
          bettingVariable.stream.id,
          roundIdEmit,
        );

        const chatMessage: ChatMessage = {
          type: ChatType.System,
          username: ChatType.StreambetBot,
          message: `${user.username} edited their bet to ${editedBet.amount} on ${bettingVariable.name}!`,
          timestamp: new Date(),
        };
        void emitToStream(
          this.gatewayManager,
          bettingVariable.stream.id,
          SocketEventName.ChatMessage,
          chatMessage,
        );
      }
    } catch (error) {
      emitToClient(client, SocketEventName.Error, {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  emitBettingUpdate(streamId: string, bettingVariableId: string): void {
    void this.bettingService
      .findBettingVariableById(bettingVariableId)
      .then(async (bettingVariable) => {
        // Broadcast betting update to stream
        emitToStream(
          this.gatewayManager,
          streamId,
          SocketEventName.BettingUpdate,
          {
            bettingVariableId: bettingVariable.id,
            totalBetsSweepCoinAmount: bettingVariable.totalBetsSweepCoinAmount,
            totalBetsGoldCoinAmount: bettingVariable.totalBetsGoldCoinAmount,
            betCountSweepCoin: bettingVariable.betCountSweepCoin,
            betCountGoldCoin: bettingVariable.betCountGoldCoin,
            status: bettingVariable.status,
          },
        );

        // Emit personalized potential winnings if roundId exists
        const roundId = bettingVariable.roundId || bettingVariable.round?.id;
        if (roundId) {
          await this.sendPersonalizedPotentialAmounts(streamId, roundId);
        }
      })
      .catch((error) =>
        this.logger.error(
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
    losers: { userId: string; username: string }[],
    voided: { goldCoin: boolean; sweepCoin: boolean } = {
      goldCoin: false,
      sweepCoin: false,
    },
  ): void {
    emitToStream(
      this.gatewayManager,
      streamId,
      SocketEventName.WinnerDeclared,
      {
        bettingVariableId,
        winnerName,
        winners,
        losers,
        voided,
      },
    );

    // Send system chat message
    const chatMessage: ChatMessage = {
      type: ChatType.System,
      username: 'StreambetBot',
      message: `The winner is: ${winnerName}!`,
      timestamp: new Date(),
    };
    emitToStream(
      this.gatewayManager,
      streamId,
      SocketEventName.ChatMessage,
      chatMessage,
    );
    Logger.log(`Emitted winner declared to ${streamId}`);
  }

  async emitBettingStatus(
    streamId: string,
    roundId: string,
    status: BettingRoundStatus,
    lockedStatus?: boolean,
  ): Promise<void> {
    let event: string;
    let message: string;
    let payload: any;

    switch (status) {
      case BettingRoundStatus.OPEN:
        event = SocketEventName.BetOpened;
        message = 'Betting is now open! Bets can be placed.';
        payload = { roundId, open: true };
        break;
      case BettingRoundStatus.LOCKED:
        event = SocketEventName.BettingLocked;
        message = 'Betting is now locked! No more bets can be placed.';
        payload = { roundId, lockedStatus };
        break;
      case BettingRoundStatus.CANCELLED:
        event = SocketEventName.BetCancelledByAdmin;
        message = 'Betting is canceled!';
        payload = { roundId, cancelled: true, message };
        break;
      default:
        throw new Error('Invalid betting status');
    }

    const chatMessage: ChatMessage = {
      type: ChatType.System,
      username: 'StreambetBot',
      message,
      timestamp: new Date(),
    };
    void emitToStream(this.gatewayManager, streamId, event, payload);
    void emitToStream(
      this.gatewayManager,
      streamId,
      SocketEventName.ChatMessage,
      chatMessage,
    );
  }
  async emitOpenBetRound(roundName: string, streamName: string) {
    // Fetch all sockets currently connected to the 'streambet' room
    const server = await this.gatewayManager.getServer();
    const sockets = await server.in(STREAMBET).fetchSockets();

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
        void server.to(socket.id).emit(SocketEventName.BotMessage, payload);

        // Log the emission for debugging/audit purposes
        Logger.log(`Emitted open bet round to 'streambet': ${roundName}`);
      }
    }
  }
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
        type: ChatType.System,
        username: 'StreambetBot',
        message,
        title,
        timestamp: new Date(),
      };

      const socketIds = Array.from(
        this.appGateway.userSocketMap.get(username) ?? [],
      );
      emitToSocket(
        this.gatewayManager,
        socketIds,
        SocketEventName.BotMessage,
        chatMessage,
      );
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
      const chatMessage: ChatMessage = {
        type: ChatType.System,
        username: 'StreambetBot',
        message: NOTIFICATION_TEMPLATE.BET_LOST.MESSAGE({
          roundName: roundName || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_LOST.TITLE(),
        timestamp: new Date(),
      };
      const socketIds = Array.from(
        this.appGateway.userSocketMap.get(username) ?? [],
      );
      emitToSocket(
        this.gatewayManager,
        socketIds,
        SocketEventName.BotMessage,
        chatMessage,
      );
    }
  }
  async emitBotMessageForWinnerDeclaration(
    userId: string,
    username: string,
    bettingOption: string,
  ) {
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);

    if (receiverNotificationPermission['inAppNotification']) {
      const chatMessage: ChatMessage = {
        type: ChatType.System,
        username: ChatType.StreambetBot,
        message: NOTIFICATION_TEMPLATE.BET_WINNER_DECLARED.MESSAGE({
          bettingOption: bettingOption || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_WINNER_DECLARED.TITLE(),
        timestamp: new Date(),
      };
      const socketIds = Array.from(
        this.appGateway.userSocketMap.get(username) ?? [],
      );
      emitToSocket(
        this.gatewayManager,
        socketIds,
        SocketEventName.BotMessage,
        chatMessage,
      );
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
      const chatMessage: ChatMessage = {
        type: ChatType.System,
        username: ChatType.StreambetBot,
        message: NOTIFICATION_TEMPLATE.BET_ROUND_VOID.MESSAGE({
          roundName: roundName || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_ROUND_VOID.TITLE(),
        timestamp: new Date(),
      };
      const socketIds = Array.from(
        this.appGateway.userSocketMap.get(username) ?? [],
      );
      emitToSocket(
        this.gatewayManager,
        socketIds,
        SocketEventName.BotMessage,
        chatMessage,
      );
    }
  }
  async emitLockBetRound(roundName: string, userId: string, username: string) {
    // Check if the user has in-app notification enabled
    const receiverNotificationPermission =
      await this.notificationService.addNotificationPermision(userId);

    if (receiverNotificationPermission['inAppNotification']) {
      const chatMessage: ChatMessage = {
        type: ChatType.System, // system message type
        username: 'StreambetBot', // bot username
        message: NOTIFICATION_TEMPLATE.BET_LOCKED.MESSAGE({
          roundName: roundName || '',
        }),
        title: NOTIFICATION_TEMPLATE.BET_LOCKED.TITLE(),
        timestamp: new Date(), // current timestamp
      };

      const socketIds = Array.from(
        this.appGateway.userSocketMap.get(username) ?? [],
      );
      emitToSocket(
        this.gatewayManager,
        socketIds,
        SocketEventName.BotMessage,
        chatMessage,
      ); // send message to the user's socket

      Logger.log(`Emitted betRound to room 'streambet': ${roundName}`); // log for debugging
    }
  }
}
