import { Logger } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import { SocketEventName } from 'src/enums/socket.enum';
import { GatewayManager } from 'src/ws/gateway.manager';
import { emitToUser } from 'src/common/common';

@WebSocketGateway()
export class WalletGateway {
  private readonly logger = new Logger(WalletGateway.name);

  constructor(private readonly gatewayManager: GatewayManager) {}

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
    emitToUser(
      this.gatewayManager,
      userId,
      SocketEventName.PurchaseSettled,
      payload,
    );
  }

  async emitAdminAddedGoldCoin(userId: string): Promise<void> {
    emitToUser(this.gatewayManager, userId, SocketEventName.RefetchEvent, {});
  }
}
