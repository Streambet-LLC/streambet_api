/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly crypto: CryptoPaymentsService,
  ) {}

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

    const prize = await this.prizeRepo.findOne({
      where: { id: order.prizeConfigurationId },
    });
    if (!prize) throw new NotFoundException('Prize configuration not found');
    if (!prize.createdBy) {
      throw new BadRequestException('Prize has no seller (createdBy)');
    }
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

    // Convert USD decimal → USDC base units (6 decimals).
    const amountBaseUnits = usdToUsdcBaseUnits(Number(order.totalPrice));
    const shippingBaseUnits = usdToUsdcBaseUnits(
      Number(prize.shippingCostUsd ?? 0),
    );

    const quote = await this.crypto.buildQuote({
      sellerWallet: seller.solanaWallet,
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
    if (!prize?.createdBy) throw new BadRequestException('Prize has no seller');
    const seller = await this.userRepo.findOne({
      where: { id: prize.createdBy },
    });
    if (!seller?.solanaWallet)
      throw new BadRequestException('Seller wallet missing');

    const expectedAmount = usdToUsdcBaseUnits(Number(order.totalPrice));
    const expectedInvoiceIdHex = Buffer.from(order.cryptoInvoiceId).toString(
      'hex',
    );

    const verdict = await this.crypto.verifyPaymentTx({
      txSignature: input.txSignature,
      expectedInvoiceIdHex,
      expectedSellerWallet: seller.solanaWallet,
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

    await this.orderRepo.update(
      { id: order.id },
      {
        status: 'paid',
        cryptoTxSignature: input.txSignature,
        cryptoBuyerWallet: input.buyerWallet,
      },
    );
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
