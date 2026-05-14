import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import { EmailsService } from '../emails/email.service';

@Injectable()
export class ShippingReminderService {
  private readonly logger = new Logger(ShippingReminderService.name);

  constructor(
    @InjectRepository(PrizeOrder)
    private prizeOrderRepository: Repository<PrizeOrder>,
    private emailsService: EmailsService,
    private configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendShippingReminders() {
    this.logger.debug('Processing shipping reminders for unpaid orders');

    try {
      // Find orders that are 4+ days old, paid, but not yet shipped
      // and have not already been reminded in the last 24 hours
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const ordersToRemind = await this.prizeOrderRepository
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.user', 'user')
        .leftJoinAndSelect('order.prizeConfiguration', 'prizeConfiguration')
        .leftJoinAndSelect('prizeConfiguration.creator', 'creator')
        .where('order.status = :status', { status: 'paid' })
        .andWhere('order.shippedAt IS NULL')
        // In-person items don't ship, so they never need a shipping reminder.
        .andWhere(
          '(prizeConfiguration.isInPerson IS NULL OR prizeConfiguration.isInPerson = false)',
        )
        .andWhere('order.createdAt < :fourDaysAgo', { fourDaysAgo })
        .andWhere(
          new Brackets((qb) => {
            qb.where('order.lastReminderSentAt IS NULL').orWhere(
              'order.lastReminderSentAt < :twentyFourHoursAgo',
              { twentyFourHoursAgo },
            );
          }),
        )
        .getMany();

      this.logger.debug(
        `Found ${ordersToRemind.length} orders needing shipping reminders`,
      );

      for (const order of ordersToRemind) {
        try {
          await this.sendReminderForOrder(order);
        } catch (error) {
          this.logger.error(
            `Failed to send reminder for order ${order.id}:`,
            error,
          );
        }
      }

      this.logger.debug('Completed shipping reminders processing');
    } catch (error) {
      this.logger.error('Error in shipping reminder cron job:', error);
    }
  }

  private async sendReminderForOrder(order: PrizeOrder): Promise<void> {
    const prize = order.prizeConfiguration;
    const seller = prize.creator;

    if (!seller || !seller.email) {
      this.logger.warn(
        `Seller ${prize.createdBy} not found or has no email for order ${order.id}`,
      );
      return;
    }

    try {
      const frontendUrl = this.configService.get<string>(
        'CLIENT_URL',
        'http://localhost:3000',
      );

      // Seller-owned items go to the seller dashboard; CardCade items
      // (no createdBy / 'cardcade' creator) go to the admin redemptions
      // panel. Mirrors the routing used in PrizeService.sendSellerShopPurchaseNotification.
      const isCardCadeItem =
        !prize.createdBy || prize.createdBy === 'cardcade';
      const markShippedUrl = isCardCadeItem
        ? `${frontendUrl}/admin/prizes/redemptions?orderId=${order.id}`
        : `${frontendUrl}/seller/shop/manage?tab=orders&orderId=${order.id}`;

      const shipping: PrizeOrder['shippingAddress'] = order.shippingAddress || {
        firstName: '',
        lastName: '',
        addressLine1: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
      };
      const buyerFullName =
        [shipping.firstName, shipping.lastName].filter(Boolean).join(' ') ||
        order.user?.name ||
        order.user?.username ||
        '';

      await this.emailsService.sendEmailSMTP(
        {
          toAddress: [seller.email],
          subject: `Reminder: Pending shipment for ${prize.name} 📦`,
          params: {
            sellerName: seller.name || seller.username,
            itemName: prize.name,
            buyerName: order.user.name || order.user.username,
            orderId: order.id,
            purchaseDate: order.createdAt.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
            buyerFullName,
            shippingAddressLine1: shipping.addressLine1 || '',
            shippingAddressLine2: shipping.addressLine2 || '',
            shippingCity: shipping.city || '',
            shippingState: shipping.state || '',
            shippingZipCode: shipping.zipCode || '',
            shippingCountry: shipping.country || '',
            markShippedUrl,
          },
        },
        'seller_shipping_reminder',
      );
      this.logger.log(
        `Shipping reminder sent to seller ${seller.email} for order ${order.id}`,
      );

      // Mark the order so we don't send another reminder for 24 hours
      await this.prizeOrderRepository.update(order.id, {
        lastReminderSentAt: new Date(),
      });
    } catch (emailError) {
      this.logger.error(
        `Failed to send shipping reminder for order ${order.id}:`,
        emailError,
      );
      throw emailError;
    }
  }
}
