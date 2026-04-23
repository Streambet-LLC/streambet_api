import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EmailsService } from '../emails/email.service';
import { ReviewsService } from '../reviews/reviews.service';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import { InboxService } from '../inbox/inbox.service';

const DAYS_AFTER_SHIPPED = 7;
const DAYS_AFTER_PURCHASE_FALLBACK = 14;

@Injectable()
export class ReviewReminderService {
  private readonly logger = new Logger(ReviewReminderService.name);

  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly emailsService: EmailsService,
    private readonly configService: ConfigService,
    private readonly inboxService: InboxService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendReviewReminders(): Promise<void> {
    this.logger.debug('Processing review reminder emails');
    try {
      // Trigger A: shipped 7+ days ago
      const shippedOrders = await this.reviewsService.findOrdersForReminder({
        anchor: 'shippedAt',
        minAgeDays: DAYS_AFTER_SHIPPED,
      });

      // Trigger B: purchased 14+ days ago (fallback for never-shipped orders).
      // findOrdersForReminder also excludes orders that already had a reminder,
      // so this won't double-fire after Trigger A.
      const oldOrders = await this.reviewsService.findOrdersForReminder({
        anchor: 'createdAt',
        minAgeDays: DAYS_AFTER_PURCHASE_FALLBACK,
      });

      // De-dupe (an order could match both queries on the same tick).
      const byId = new Map<string, PrizeOrder>();
      for (const o of [...shippedOrders, ...oldOrders]) byId.set(o.id, o);

      this.logger.debug(
        `Found ${byId.size} orders eligible for review reminder`,
      );

      for (const order of byId.values()) {
        try {
          await this.processOrder(order);
        } catch (err) {
          this.logger.error(
            `Failed to process review reminder for order ${order.id}: ${
              (err as Error).message
            }`,
          );
        }
      }
    } catch (err) {
      this.logger.error('Error in review reminder cron job:', err);
    }
  }

  private async processOrder(order: PrizeOrder): Promise<void> {
    const buyer = order.user;
    const prize = order.prizeConfiguration;
    const seller = prize?.creator;

    if (!buyer || !seller || !prize) {
      // Missing relations — nothing we can do, mark as sent so we don't retry forever
      await this.reviewsService.markReviewReminderSent(order.id);
      return;
    }

    const frontendUrl = this.configService.get<string>(
      'CLIENT_URL',
      'http://localhost:3000',
    );

    const purchaseDate = new Date(order.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Suppress per side if the user has already left a review for this order
    const buyerHasReviewed = await this.reviewsService.hasUserReviewedOrder(
      buyer.id,
      order.id,
    );
    const sellerHasReviewed = await this.reviewsService.hasUserReviewedOrder(
      seller.id,
      order.id,
    );

    const sentTasks: Promise<unknown>[] = [];

    if (!buyerHasReviewed && buyer.email) {
      const reviewUrl = `${frontendUrl}/transactions?leave=${order.id}`;
      const sellerUrl = `${frontendUrl}/${seller.username}`;
      const imageMd = prize.imageUrl
        ? `![${prize.name}](${prize.imageUrl})\n`
        : '';
      sentTasks.push(
        this.emailsService
          .sendEmailSMTP(
            {
              toAddress: [buyer.email],
              subject: `How was your purchase from ${seller.username}? ⭐`,
              params: {
                buyerName: buyer.name || buyer.username,
                sellerName: seller.name || seller.username,
                itemName: prize.name,
                orderId: order.id,
                purchaseDate,
                reviewUrl,
              },
            },
            'review_reminder_buyer',
          )
          .then(() =>
            this.logger.log(`Buyer review reminder sent for order ${order.id}`),
          ),
      );
      sentTasks.push(
        this.inboxService
          .sendSystemMessageToUser(
            buyer.id,
            `${imageMd}How was your purchase of ${prize.name} from [@${seller.username}](${sellerUrl})? Share your experience to help other collectors.\n[Leave a review](${reviewUrl})`,
          )
          .catch((err) =>
            this.logger.warn(
              `Failed to send buyer in-app review reminder for order ${order.id}: ${(err as Error).message}`,
            ),
          ),
      );
    }

    if (!sellerHasReviewed && seller.email) {
      const reviewUrl = `${frontendUrl}/transactions?leave=${order.id}`;
      const buyerUrl = `${frontendUrl}/${buyer.username}`;
      const imageMd = prize.imageUrl
        ? `![${prize.name}](${prize.imageUrl})\n`
        : '';
      sentTasks.push(
        this.emailsService
          .sendEmailSMTP(
            {
              toAddress: [seller.email],
              subject: `Leave a review for your buyer ${buyer.username} ⭐`,
              params: {
                buyerName: buyer.name || buyer.username,
                sellerName: seller.name || seller.username,
                itemName: prize.name,
                orderId: order.id,
                purchaseDate,
                reviewUrl,
              },
            },
            'review_reminder_seller',
          )
          .then(() =>
            this.logger.log(
              `Seller review reminder sent for order ${order.id}`,
            ),
          ),
      );
      sentTasks.push(
        this.inboxService
          .sendSystemMessageToUser(
            seller.id,
            `${imageMd}Your sale of ${prize.name} to [@${buyer.username}](${buyerUrl}) is complete — how was the buyer?\n[Leave a review](${reviewUrl})`,
          )
          .catch((err) =>
            this.logger.warn(
              `Failed to send seller in-app review reminder for order ${order.id}: ${(err as Error).message}`,
            ),
          ),
      );
    }

    // If both already reviewed, no email is needed but we still mark the order
    // so the cron stops considering it.
    await Promise.allSettled(sentTasks);
    await this.reviewsService.markReviewReminderSent(order.id);
  }
}
