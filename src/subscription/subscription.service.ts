import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  ConflictException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { Subscription } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import {
  SubscriptionPlan,
  SubscriptionStatus,
} from '../enums/subscription-plan.enum';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class SubscriptionService {
  private stripe: Stripe;
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private configService: ConfigService,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || '',
    );
  }

  /**
   * Get the Stripe Price ID for the given plan
   */
  private getPriceId(plan: SubscriptionPlan): string {
    const key =
      plan === SubscriptionPlan.MONTHLY
        ? 'STRIPE_PRO_MONTHLY_PRICE_ID'
        : 'STRIPE_PRO_YEARLY_PRICE_ID';
    const priceId = this.configService.get<string>(key);
    if (!priceId) {
      throw new BadRequestException(
        `Stripe price ID not configured for ${plan} plan`,
      );
    }
    return priceId;
  }

  /**
   * Get or create a Stripe Customer for the user
   */
  private async getOrCreateStripeCustomer(user: User): Promise<string> {
    // Check if user already has a subscription with a customer ID
    const existing = await this.subscriptionRepository.findOne({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });

    if (existing?.stripeCustomerId) {
      return existing.stripeCustomerId;
    }

    // Create a new Stripe Customer
    const customer = await this.stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id, username: user.username },
    });

    return customer.id;
  }

  /**
   * Create a Stripe Checkout Session for a subscription
   */
  async createCheckoutSession(
    userId: string,
    plan: SubscriptionPlan,
  ): Promise<{ sessionId: string; url: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user already has an active subscription
    const activeSubscription = await this.subscriptionRepository.findOne({
      where: { userId, status: SubscriptionStatus.ACTIVE },
    });
    if (activeSubscription) {
      throw new ConflictException(
        'You already have an active CardCade Pro subscription',
      );
    }

    const customerId = await this.getOrCreateStripeCustomer(user);
    const priceId = this.getPriceId(plan);
    const clientUrl =
      this.configService.get<string>('CLIENT_URL') ||
      this.configService.get<string>('APPLICATION_HOST') ||
      'http://localhost:3000';

    this.logger.log(
      `Creating checkout session: user=${userId}, plan=${plan}, priceId=${priceId}, clientUrl=${clientUrl}`,
    );

    try {
      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${clientUrl}/settings?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/settings?subscription=cancel`,
        metadata: {
          userId,
          plan,
          type: 'cardcade_pro',
        },
        subscription_data: {
          metadata: {
            userId,
            plan,
            type: 'cardcade_pro',
          },
        },
      });

      return { sessionId: session.id, url: session.url };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to create Stripe checkout session: ${message}`,
        stack,
      );
      throw new BadRequestException(
        `Failed to create checkout session: ${message}`,
      );
    }
  }

  /**
   * Upgrade from monthly to yearly with proration
   */
  async upgradeToYearly(userId: string): Promise<{ success: boolean }> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId, status: SubscriptionStatus.ACTIVE },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    if (subscription.plan === SubscriptionPlan.YEARLY) {
      throw new BadRequestException('You are already on the yearly plan');
    }

    const yearlyPriceId = this.getPriceId(SubscriptionPlan.YEARLY);

    // Retrieve the Stripe subscription to get the current item
    const stripeSub = await this.stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
    );

    // Update the subscription with proration
    await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      items: [
        {
          id: stripeSub.items.data[0].id,
          price: yearlyPriceId,
        },
      ],
      proration_behavior: 'create_prorations',
    });

    // Update local record
    subscription.plan = SubscriptionPlan.YEARLY;
    subscription.stripePriceId = yearlyPriceId;
    await this.subscriptionRepository.save(subscription);

    return { success: true };
  }

  /**
   * Get the active subscription for a user
   */
  async getActiveSubscription(userId: string): Promise<Subscription | null> {
    return this.subscriptionRepository.findOne({
      where: { userId, status: SubscriptionStatus.ACTIVE },
    });
  }

  /**
   * Handle Stripe subscription webhook events
   */
  async handleSubscriptionWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object);
        break;
      default:
        this.logger.log(`Unhandled subscription event: ${event.type}`);
    }
  }

  /**
   * Handle subscription created/updated webhook
   */
  private async handleSubscriptionUpdated(
    stripeSub: Stripe.Subscription,
  ): Promise<void> {
    const userId = stripeSub.metadata?.userId;
    if (!userId || stripeSub.metadata?.type !== 'cardcade_pro') {
      return; // Not a CardCade Pro subscription
    }

    const plan =
      stripeSub.metadata?.plan === 'yearly'
        ? SubscriptionPlan.YEARLY
        : SubscriptionPlan.MONTHLY;

    const statusMap: Record<string, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      past_due: SubscriptionStatus.PAST_DUE,
      canceled: SubscriptionStatus.CANCELLED,
      unpaid: SubscriptionStatus.EXPIRED,
    };

    const status = statusMap[stripeSub.status] || SubscriptionStatus.ACTIVE;

    // Upsert the subscription record
    let subscription = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });

    if (subscription) {
      subscription.status = status;
      subscription.plan = plan;
      subscription.stripePriceId =
        stripeSub.items.data[0]?.price?.id || subscription.stripePriceId;
      subscription.currentPeriodStart = new Date(
        stripeSub.items.data[0].current_period_start * 1000,
      );
      subscription.currentPeriodEnd = new Date(
        stripeSub.items.data[0].current_period_end * 1000,
      );
    } else {
      subscription = this.subscriptionRepository.create({
        userId,
        plan,
        status,
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId:
          typeof stripeSub.customer === 'string'
            ? stripeSub.customer
            : stripeSub.customer.id,
        stripePriceId: stripeSub.items.data[0]?.price?.id || null,
        currentPeriodStart: new Date(
          stripeSub.items.data[0].current_period_start * 1000,
        ),
        currentPeriodEnd: new Date(
          stripeSub.items.data[0].current_period_end * 1000,
        ),
      });
    }

    await this.subscriptionRepository.save(subscription);

    // Update user's pro status
    await this.userRepository.update(userId, {
      isProSubscriber: status === SubscriptionStatus.ACTIVE,
    });

    // Send welcome email for new subscriptions
    if (stripeSub.status === 'active' && !subscription.id) {
      const user = await this.userRepository.findOne({
        where: { id: userId },
      });
      if (user) {
        await this.notificationService.sendProSubscriptionEmail(
          user,
          plan,
          'activated',
        );
      }
    }
  }

  /**
   * Handle subscription deleted webhook
   */
  private async handleSubscriptionDeleted(
    stripeSub: Stripe.Subscription,
  ): Promise<void> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });

    if (!subscription) return;

    subscription.status = SubscriptionStatus.CANCELLED;
    subscription.cancelledAt = new Date();
    await this.subscriptionRepository.save(subscription);

    // Update user's pro status
    await this.userRepository.update(subscription.userId, {
      isProSubscriber: false,
    });

    const user = await this.userRepository.findOne({
      where: { id: subscription.userId },
    });
    if (user) {
      await this.notificationService.sendProSubscriptionEmail(
        user,
        subscription.plan,
        'cancelled',
      );
    }
  }

  /**
   * Handle payment failed webhook
   */
  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const subDetails = invoice.parent?.subscription_details;
    const subscriptionRef = subDetails?.subscription;
    const subscriptionId =
      typeof subscriptionRef === 'string'
        ? subscriptionRef
        : subscriptionRef?.id;

    if (!subscriptionId) return;

    const subscription = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (!subscription) return;

    subscription.status = SubscriptionStatus.PAST_DUE;
    await this.subscriptionRepository.save(subscription);

    await this.userRepository.update(subscription.userId, {
      isProSubscriber: false,
    });
  }

  /**
   * Admin: manually grant pro subscription
   */
  async adminGrantPro(
    userId: string,
    plan: SubscriptionPlan = SubscriptionPlan.MONTHLY,
  ): Promise<Subscription> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check for existing active subscription
    const existing = await this.subscriptionRepository.findOne({
      where: { userId, status: SubscriptionStatus.ACTIVE },
    });
    if (existing) {
      throw new ConflictException('User already has an active subscription');
    }

    const subscription = this.subscriptionRepository.create({
      userId,
      plan,
      status: SubscriptionStatus.ACTIVE,
      stripeSubscriptionId: `admin_grant_${Date.now()}`,
      stripeCustomerId: `admin_grant_${userId}`,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(
        Date.now() +
          (plan === SubscriptionPlan.YEARLY
            ? 365 * 24 * 60 * 60 * 1000
            : 30 * 24 * 60 * 60 * 1000),
      ),
    });

    await this.subscriptionRepository.save(subscription);
    await this.userRepository.update(userId, { isProSubscriber: true });

    return subscription;
  }

  /**
   * Admin: revoke pro subscription
   */
  async adminRevokePro(userId: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId, status: SubscriptionStatus.ACTIVE },
    });

    if (subscription) {
      // If it's a real Stripe subscription, cancel it
      if (!subscription.stripeSubscriptionId.startsWith('admin_grant_')) {
        try {
          await this.stripe.subscriptions.cancel(
            subscription.stripeSubscriptionId,
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          this.logger.warn(`Failed to cancel Stripe subscription: ${message}`);
        }
      }

      subscription.status = SubscriptionStatus.CANCELLED;
      subscription.cancelledAt = new Date();
      await this.subscriptionRepository.save(subscription);
    }

    await this.userRepository.update(userId, { isProSubscriber: false });
  }

  /**
   * Verify a Stripe webhook event
   */
  verifyWebhookSignature(payload: Buffer, signature: string): Stripe.Event {
    const secret = this.configService.get<string>(
      'STRIPE_SUBSCRIPTION_WEBHOOK_SECRET',
    );
    if (!secret) {
      throw new BadRequestException(
        'Subscription webhook secret not configured',
      );
    }
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
