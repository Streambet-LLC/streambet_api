import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrizeOrder } from '../../prize/entities/prize-order.entity';
import { PrizeConfiguration } from '../../prize/entities/prize-configuration.entity';
import { PrizeRedemption } from '../../prize/entities/prize-redemption.entity';
import { ShopSettings } from '../../prize/entities/shop-settings.entity';
import { PrizeCategory } from '../../prize/enums/prize-category.enum';
import { ShippingStatus } from '../../prize/dto/prize-redemption.dto';
import { User } from '../../users/entities/user.entity';
import {
  CryptoPaymentsService,
  CryptoPaymentQuote,
} from './crypto-payments.service';

/**
 * Bridges PrizeOrder records ↔ on-chain pay_invoice flow.
 * - quote(): generates an invoice id, persists it on the order, returns
 *   everything the wallet needs to construct the tx.
 * - confirm(): verifies the tx and marks the order paid.
 */
@Injectable()
export class CryptoOrderService {
  private readonly logger = new Logger(CryptoOrderService.name);

  constructor(
    @InjectRepository(PrizeOrder)
    private readonly orderRepo: Repository<PrizeOrder>,
    @InjectRepository(PrizeConfiguration)
    private readonly prizeRepo: Repository<PrizeConfiguration>,
    @InjectRepository(PrizeRedemption)
    private readonly redemptionRepo: Repository<PrizeRedemption>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ShopSettings)
    private readonly shopSettingsRepo: Repository<ShopSettings>,
    private readonly crypto: CryptoPaymentsService,
  ) {}

  /**
   * Resolve the destination wallet for a prize order. Individual sellers'
   * payouts come from their User row; CardCade-owned items (createdBy is
   * NULL) fall back to the platform-level cardcade row in `shop_settings`,
   * which an admin maintains via Seller Shop Manage.
   */
  private async resolveSellerWallet(prize: PrizeConfiguration): Promise<{
    wallet: string;
    /** Human label for log lines. */
    source: 'user' | 'cardcade';
  }> {
    if (prize.createdBy) {
      const seller = await this.userRepo.findOne({
        where: { id: prize.createdBy },
      });
      if (!seller) throw new NotFoundException('Seller not found');
      if (!seller.solanaWallet) {
        throw new BadRequestException(
          'Seller has not configured a Solana wallet',
        );
      }
      if (!seller.cryptoPaymentsEnabled) {
        throw new BadRequestException(
          'Seller is not approved for crypto payments',
        );
      }
      return { wallet: seller.solanaWallet, source: 'user' };
    }

    // Platform-owned (CardCade) item.
    const settings = await this.shopSettingsRepo.findOne({
      where: { shopKey: 'cardcade' },
    });
    if (!settings?.cryptoPaymentsEnabled || !settings.cryptoWalletAddress) {
      throw new BadRequestException(
        'Crypto payments are not enabled for this shop',
      );
    }
    return { wallet: settings.cryptoWalletAddress, source: 'cardcade' };
  }

  async quote(input: {
    orderId: string;
    buyerUserId: string;
    buyerWallet: string;
  }): Promise<CryptoPaymentQuote> {
    const order = await this.orderRepo.findOne({
      where: { id: input.orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== input.buyerUserId) {
      throw new ForbiddenException('Not your order');
    }
    if (
      order.status === 'paid' ||
      order.status === 'shipped' ||
      order.status === 'delivered'
    ) {
      throw new BadRequestException(`Order already ${order.status}`);
    }
    if (order.paymentMethod !== 'crypto') {
      throw new BadRequestException(
        'Order is not configured for crypto payment',
      );
    }

    // Refuse to mint a quote when admins have paused on-chain sales — the
    // contract would reject the pay_invoice tx anyway, but failing here
    // gives the buyer a clean error before they sign anything.
    const market = await this.crypto.getMarketplaceConfig();
    if (market.paused) {
      throw new BadRequestException(
        'Crypto payments are temporarily paused. Please try again later.',
      );
    }

    const prize = await this.prizeRepo.findOne({
      where: { id: order.prizeConfigurationId },
    });
    if (!prize) throw new NotFoundException('Prize configuration not found');
    const { wallet: sellerWallet } = await this.resolveSellerWallet(prize);

    // Convert USD decimal → USDC base units (6 decimals).
    const amountBaseUnits = usdToUsdcBaseUnits(Number(order.totalPrice));
    const shippingBaseUnits = usdToUsdcBaseUnits(
      Number(prize.shippingCostUsd ?? 0),
    );

    const quote = await this.crypto.buildQuote({
      sellerWallet,
      buyerWallet: input.buyerWallet,
      amountBaseUnits,
      shippingBaseUnits,
    });

    // Persist invoice id (16 bytes) + buyer wallet for later verification.
    const invoiceIdBuf = Buffer.from(quote.invoiceId, 'hex');
    await this.orderRepo.update(
      { id: order.id },
      {
        cryptoInvoiceId: invoiceIdBuf,
        cryptoBuyerWallet: input.buyerWallet,
      },
    );

    return quote;
  }

  async confirm(input: {
    orderId: string;
    buyerUserId: string;
    txSignature: string;
    buyerWallet: string;
  }): Promise<{ ok: true; status: string }> {
    const order = await this.orderRepo.findOne({
      where: { id: input.orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== input.buyerUserId) {
      throw new ForbiddenException('Not your order');
    }
    if (!order.cryptoInvoiceId) {
      throw new BadRequestException(
        'No quote on file for this order — call /quote first',
      );
    }
    if (
      order.status === 'paid' ||
      order.status === 'shipped' ||
      order.status === 'delivered'
    ) {
      return { ok: true, status: order.status };
    }

    const prize = await this.prizeRepo.findOne({
      where: { id: order.prizeConfigurationId },
    });
    if (!prize) throw new NotFoundException('Prize configuration not found');
    const { wallet: sellerWallet } = await this.resolveSellerWallet(prize);

    const expectedAmount = usdToUsdcBaseUnits(Number(order.totalPrice));
    const expectedInvoiceIdHex = Buffer.from(order.cryptoInvoiceId).toString(
      'hex',
    );

    const verdict = await this.crypto.verifyPaymentTx({
      txSignature: input.txSignature,
      expectedInvoiceIdHex,
      expectedSellerWallet: sellerWallet,
      expectedBuyerWallet: input.buyerWallet,
      expectedAmount,
    });
    if (!verdict.ok) {
      this.logger.warn(
        `crypto confirm failed order=${order.id} tx=${input.txSignature}: ${verdict.reason}`,
      );
      throw new BadRequestException(
        `Payment verification failed: ${verdict.reason}`,
      );
    }

    // Mark order paid + persist on-chain proof in one update.
    await this.orderRepo.update(
      { id: order.id },
      {
        status: 'paid',
        cryptoTxSignature: input.txSignature,
        cryptoBuyerWallet: input.buyerWallet,
      },
    );

    // Mirror the post-paid pipeline used by Stripe so the buyer gets the same
    // experience: persist shipping address, create a redemption row, and
    // decrement on-hand stock. Each block is wrapped so a downstream failure
    // doesn't roll back the paid status — funds already moved on-chain.
    try {
      if (order.shippingAddress) {
        await this.userRepo.update(order.userId, {
          firstName: order.shippingAddress.firstName,
          lastName: order.shippingAddress.lastName,
          address: order.shippingAddress.addressLine1,
          address2: order.shippingAddress.addressLine2 || null,
          city: order.shippingAddress.city,
          state: order.shippingAddress.state,
          zipCode: order.shippingAddress.zipCode,
          country: order.shippingAddress.country,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to update shipping address for user ${order.userId}: ${
          (err as Error)?.message
        }`,
      );
    }

    try {
      const existing = await this.redemptionRepo.findOne({
        where: { prizeOrderId: order.id },
      });
      if (!existing) {
        let prizeCategory: PrizeCategory = PrizeCategory.SLAB;
        if (prize.category === 'sealed') prizeCategory = PrizeCategory.SEALED;
        else if (prize.category === 'raw') prizeCategory = PrizeCategory.RAW;
        const redemption = this.redemptionRepo.create({
          userId: order.userId,
          prizeConfigurationId: order.prizeConfigurationId,
          prizeOrderId: order.id,
          dateRedeemed: new Date(),
          prizeTier: prize.prizeTier,
          prizeCategory,
          shippingStatus: ShippingStatus.OPEN,
          fulfilled: false,
        });
        await this.redemptionRepo.save(redemption);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to create redemption for order ${order.id}: ${
          (err as Error)?.message
        }`,
      );
    }

    try {
      const prizeFresh = await this.prizeRepo.findOne({
        where: { id: order.prizeConfigurationId },
      });
      if (prizeFresh) {
        prizeFresh.stock = Math.max(0, prizeFresh.stock - 1);
        await this.prizeRepo.save(prizeFresh);
        this.logger.log(
          `Stock decremented for prize ${prizeFresh.id} → ${prizeFresh.stock} (crypto)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to decrement stock for prize ${order.prizeConfigurationId}: ${
          (err as Error)?.message
        }`,
      );
    }

    this.logger.log(
      `Order ${order.id} marked paid via crypto tx ${input.txSignature}`,
    );
    return { ok: true, status: 'paid' };
  }
}

/** Convert a USD decimal (e.g. 12.34) into USDC base units (1e6). */
function usdToUsdcBaseUnits(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new BadRequestException(`Invalid USD amount: ${usd}`);
  }
  // Avoid float drift: round to 6 decimals.
  return BigInt(Math.round(usd * 1_000_000));
}
