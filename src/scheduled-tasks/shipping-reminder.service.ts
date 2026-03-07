import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThan } from 'typeorm';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import { EmailsService } from '../emails/email.service';

@Injectable()
export class ShippingReminderService {
  private readonly logger = new Logger(ShippingReminderService.name);

  constructor(
    @InjectRepository(PrizeOrder)
    private prizeOrderRepository: Repository<PrizeOrder>,
    private emailsService: EmailsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendShippingReminders() {
    this.logger.debug('Processing shipping reminders for unpaid orders');

    try {
      // Find orders that are 4+ days old, paid, but not yet shipped
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

      const ordersToRemind = await this.prizeOrderRepository.find({
        where: {
          status: 'paid',
          shippedAt: IsNull(),
          createdAt: LessThan(fourDaysAgo),
        },
        relations: ['user', 'prizeConfiguration', 'prizeConfiguration.creator'],
      });

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
          },
        },
        'seller_shipping_reminder',
      );
      this.logger.log(
        `Shipping reminder sent to seller ${seller.email} for order ${order.id}`,
      );
    } catch (emailError) {
      this.logger.error(
        `Failed to send shipping reminder for order ${order.id}:`,
        emailError,
      );
      throw emailError;
    }
  }
}
