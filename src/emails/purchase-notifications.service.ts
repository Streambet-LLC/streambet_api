import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EmailsService } from './email.service';
import { User } from '../users/entities/user.entity';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import { PrizeConfiguration } from '../prize/entities/prize-configuration.entity';
import { BUYER_PROCESSING_FEE_PERCENT } from '../common/utils/fee-utils';

/**
 * Buyer/seller shop-purchase notification emails, shared by both the
 * single-item purchase flow (`PrizeService`) and the multi-item cart flow
 * (`CartService`) so there is a single source of truth for purchase emails.
 *
 * ACH timing rule: the seller is NEVER told to ship while funds are still
 * settling. At purchase time `isPaymentProcessing` shows a "DO NOT SHIP"
 * banner; a separate `sendSellerPaymentSettledNotification` fires only once
 * the ACH payment clears (`payment_intent.succeeded`).
 *
 * Every send is best-effort: failures are logged, never thrown, so order
 * processing is unaffected by a transient email problem.
 */
@Injectable()
export class PurchaseNotificationsService {
  private readonly logger = new Logger(PurchaseNotificationsService.name);

  constructor(
    private readonly emailsService: EmailsService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Notify the seller/admin that one of their items was purchased. When
   * `isPaymentProcessing` is true (ACH still settling) the template shows a
   * prominent DO-NOT-SHIP banner and suppresses the Mark-as-Shipped CTA.
   */
  async sendSellerShopPurchaseNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
    options: { isPaymentProcessing?: boolean } = {},
  ): Promise<void> {
    try {
      let recipientEmail: string;
      let recipientName: string;
      let markShippedUrl: string | undefined;
      const isInPerson = prize.isInPerson === true;

      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );

      if (!prize.createdBy) {
        recipientEmail =
          this.configService.get<string>('ADMIN_EMAIL') ||
          'contact@cardcade.fun';
        recipientName = 'CardCade Admin';
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl}/admin/prizes/redemptions?orderId=${order.id}`;
      } else {
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });

        if (!seller || !seller.email) {
          this.logger.warn(
            `Seller ${prize.createdBy} not found or has no email for order ${order.id}`,
          );
          return;
        }

        recipientEmail = seller.email;
        recipientName = seller.name || seller.username;
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl}/seller/shop/manage?tab=orders&orderId=${order.id}`;
      }

      // Show the recipient the amount without the buyer service fee
      const BUYER_FEE_PERCENT = BUYER_PROCESSING_FEE_PERCENT;
      const charged = parseFloat(order.usdCharged?.toString() || '0');
      const sellerVisibleAmount =
        charged > 0
          ? parseFloat((charged / (1 + BUYER_FEE_PERCENT / 100)).toFixed(2))
          : order.totalPrice;

      const shipping: PrizeOrder['shippingAddress'] = order.shippingAddress || {
        firstName: '',
        lastName: '',
        addressLine1: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
      };

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [recipientEmail],
          subject: `New Sale! ${prize.name} has been purchased 🎉`,
          params: {
            sellerName: recipientName,
            itemName: prize.name,
            buyerName: buyer.name || buyer.username,
            amount: sellerVisibleAmount,
            orderId: order.id,
            purchaseDate: new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
            buyerFullName: buyer.name || buyer.username,
            shippingAddressLine1: isInPerson ? '' : shipping.addressLine1 || '',
            shippingAddressLine2: isInPerson ? '' : shipping.addressLine2 || '',
            shippingCity: isInPerson ? '' : shipping.city || '',
            shippingState: isInPerson ? '' : shipping.state || '',
            shippingZipCode: isInPerson ? '' : shipping.zipCode || '',
            shippingCountry: isInPerson ? '' : shipping.country || '',
            markShippedUrl,
            isPaymentProcessing: options.isPaymentProcessing === true,
          },
        },
        'seller_shop_purchase',
      );
      this.logger.log(
        `Shop purchase notification sent to ${recipientEmail} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send shop purchase email for order ${order.id}:`,
        emailError,
      );
    }
  }

  /**
   * Confirm the purchase to the buyer. When `isPaymentProcessing` is true the
   * template notes the ACH payment is still settling.
   */
  async sendBuyerShopPurchaseNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
    options: { isPaymentProcessing?: boolean } = {},
  ): Promise<void> {
    if (!buyer.email) {
      this.logger.warn(`Buyer ${buyer.id} has no email for order ${order.id}`);
      return;
    }

    try {
      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );

      let sellerName = 'CardCade';
      if (prize.createdBy) {
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });
        if (seller) {
          sellerName = seller.name || seller.username;
        }
      }

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [buyer.email],
          subject: `Purchase Confirmed! ${prize.name} 🎉`,
          params: {
            buyerName: buyer.name || buyer.username,
            itemName: prize.name,
            sellerName,
            amount: parseFloat(order.totalPrice?.toString() || '0'),
            orderId: order.id,
            purchaseDate: new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
            shopUrl: `${frontendUrl}/shop`,
            isPaymentProcessing: options.isPaymentProcessing === true,
          },
        },
        'buyer_shop_purchase',
      );
      this.logger.log(
        `Buyer shop purchase notification sent to ${buyer.email} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send buyer shop purchase email for order ${order.id}:`,
        emailError,
      );
    }
  }

  /**
   * Notify seller/admin that an ACH payment has fully settled and the order
   * is now safe to ship.
   */
  async sendSellerPaymentSettledNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
  ): Promise<void> {
    try {
      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );
      const isInPerson = prize.isInPerson === true;

      let recipientEmail: string;
      let recipientName: string;
      let markShippedUrl: string | undefined;

      if (!prize.createdBy) {
        recipientEmail =
          this.configService.get<string>('ADMIN_EMAIL') ||
          'contact@cardcade.fun';
        recipientName = 'CardCade Admin';
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl}/admin/prizes/redemptions?orderId=${order.id}`;
      } else {
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });
        if (!seller || !seller.email) {
          this.logger.warn(
            `Seller ${prize.createdBy} not found or has no email for settled order ${order.id}`,
          );
          return;
        }
        recipientEmail = seller.email;
        recipientName = seller.name || seller.username;
        markShippedUrl = isInPerson
          ? undefined
          : `${frontendUrl}/seller/shop/manage?tab=orders&orderId=${order.id}`;
      }

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [recipientEmail],
          subject: `Payment Settled — Safe to Ship: ${prize.name}`,
          params: {
            sellerName: recipientName,
            itemName: prize.name,
            buyerName: buyer.name || buyer.username,
            orderId: order.id,
            markShippedUrl,
          },
        },
        'seller_payment_settled',
      );
      this.logger.log(
        `Payment-settled notification sent to ${recipientEmail} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send payment-settled email for order ${order.id}:`,
        emailError,
      );
    }
  }

  /**
   * Notify seller/admin that an ACH payment failed and the order has been
   * reverted (stock restored, redemption removed).
   */
  async sendSellerPaymentFailedNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
  ): Promise<void> {
    try {
      let recipientEmail: string;
      let recipientName: string;

      if (!prize.createdBy) {
        recipientEmail =
          this.configService.get<string>('ADMIN_EMAIL') ||
          'contact@cardcade.fun';
        recipientName = 'CardCade Admin';
      } else {
        const seller = await this.userRepository.findOne({
          where: { id: prize.createdBy },
        });
        if (!seller || !seller.email) {
          this.logger.warn(
            `Seller ${prize.createdBy} not found or has no email for failed order ${order.id}`,
          );
          return;
        }
        recipientEmail = seller.email;
        recipientName = seller.name || seller.username;
      }

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [recipientEmail],
          subject: `Payment Failed — Order Cancelled: ${prize.name}`,
          params: {
            sellerName: recipientName,
            itemName: prize.name,
            buyerName: buyer.name || buyer.username,
            orderId: order.id,
          },
        },
        'seller_payment_failed',
      );
      this.logger.log(
        `Payment-failed notification sent to ${recipientEmail} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send payment-failed email for order ${order.id}:`,
        emailError,
      );
    }
  }

  /**
   * Notify the buyer that their ACH payment failed and the order was
   * cancelled. Uses the existing `buyer_payment_failed` template.
   */
  async sendBuyerPaymentFailedNotification(
    order: PrizeOrder,
    prize: PrizeConfiguration,
    buyer: User,
  ): Promise<void> {
    if (!buyer.email) {
      this.logger.warn(
        `Buyer ${buyer.id} has no email for failed order ${order.id}`,
      );
      return;
    }

    try {
      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [buyer.email],
          subject: `Payment Failed — Order Cancelled: ${prize.name}`,
          params: {
            buyerName: buyer.name || buyer.username,
            itemName: prize.name,
            orderId: order.id,
            message:
              'Your bank payment (ACH) could not be completed, so this order has been cancelled and the item released. No charge was made. You can try purchasing again with a card for instant confirmation.',
          },
        },
        'buyer_payment_failed',
      );
      this.logger.log(
        `Buyer payment-failed notification sent to ${buyer.email} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send buyer payment-failed email for order ${order.id}:`,
        emailError,
      );
    }
  }
}
