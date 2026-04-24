import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { User } from '../users/entities/user.entity';

/**
 * Stripe wrapper scoped to the auctions feature.
 *
 * Why a dedicated service:
 *  - The autopay flow needs three primitives the existing PaymentsService
 *    doesn't expose: (1) lazy customer create + persistence on
 *    `users.stripe_customer_id`, (2) SetupIntent creation for saving a
 *    card off-session, (3) off-session PaymentIntent capture against a
 *    saved PaymentMethod at auction close.
 *  - Keeping it separate avoids further bloating PaymentsService (1387
 *    lines) and lets us evolve auction-payment policy independently.
 *
 * Money handling: USD float in / cents out. We round to nearest cent.
 */
@Injectable()
export class AuctionsPaymentsService {
  private readonly logger = new Logger(AuctionsPaymentsService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || '',
    );
  }

  /**
   * Returns a usable Stripe customer id for `userId`, creating one if
   * needed and persisting it on `users.stripe_customer_id`.
   */
  async getOrCreateCustomerForUser(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    const customer = await this.stripe.customers.create({
      email: user.email ?? undefined,
      name: user.username ?? undefined,
      metadata: { userId: user.id, source: 'auctions' },
    });

    await this.userRepository.update(
      { id: user.id },
      { stripeCustomerId: customer.id },
    );

    this.logger.log(
      `Created Stripe customer ${customer.id} for userId=${user.id}`,
    );
    return customer.id;
  }

  /**
   * Creates a SetupIntent so the frontend can collect & save a card
   * off-session. The returned client_secret is consumed by Stripe Elements.
   */
  async createSetupIntent(
    userId: string,
  ): Promise<{ clientSecret: string; customerId: string }> {
    const customerId = await this.getOrCreateCustomerForUser(userId);

    const intent = await this.stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: { userId, source: 'auctions' },
    });

    return {
      clientSecret: intent.client_secret ?? '',
      customerId,
    };
  }

  /**
   * Hosted Stripe Checkout in `mode: 'setup'`. Returns a redirect URL so
   * the bidder can save a card without us shipping Stripe Elements in
   * this PR. On return, the card is attached to the customer and the
   * bidder can call placeBid() with no extra setup.
   */
  async createSetupCheckoutSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const customerId = await this.getOrCreateCustomerForUser(userId);

    const session = await this.stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      payment_method_types: ['card'],
      success_url: `${returnUrl}${
        returnUrl.includes('?') ? '&' : '?'
      }auction_card_saved=1`,
      cancel_url: `${returnUrl}${
        returnUrl.includes('?') ? '&' : '?'
      }auction_card_saved=0`,
      metadata: { userId, source: 'auctions' },
    });

    if (!session.url) {
      throw new BadRequestException('Failed to create setup checkout session');
    }
    return { url: session.url };
  }

  /**
   * Verifies that a PaymentMethod is attached to the user's customer.
   * Throws if not — prevents bidders from spoofing a `pm_...` they don't
   * own.
   */
  async assertPaymentMethodBelongsToUser(
    userId: string,
    paymentMethodId: string,
  ): Promise<void> {
    const customerId = await this.getOrCreateCustomerForUser(userId);
    const pm = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customerId) {
      throw new BadRequestException(
        'Saved payment method does not belong to this user.',
      );
    }
  }

  /**
   * Returns the user's saved cards (for the bid modal "use saved card"
   * chip). Empty list = first-time bidder, must run SetupIntent first.
   */
  async listSavedCards(userId: string): Promise<
    Array<{
      id: string;
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    }>
  > {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.stripeCustomerId) return [];

    const list = await this.stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: 'card',
    });

    return list.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'card',
      last4: pm.card?.last4 ?? '',
      expMonth: pm.card?.exp_month ?? 0,
      expYear: pm.card?.exp_year ?? 0,
    }));
  }

  /**
   * Off-session charge for the auction winner. Returns the
   * PaymentIntent. Caller is responsible for handling `requires_action`
   * (3DS) by surfacing the next_action client secret to the user
   * (post-close UI).
   */
  async chargeWinner(params: {
    userId: string;
    paymentMethodId: string;
    amountUsd: number;
    auctionId: string;
    description: string;
  }): Promise<Stripe.PaymentIntent> {
    const customerId = await this.getOrCreateCustomerForUser(params.userId);

    const amountCents = Math.round(params.amountUsd * 100);
    if (amountCents <= 0) {
      throw new BadRequestException('Charge amount must be > 0');
    }

    const intent = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: customerId,
      payment_method: params.paymentMethodId,
      off_session: true,
      confirm: true,
      description: params.description,
      metadata: {
        auctionId: params.auctionId,
        userId: params.userId,
        source: 'auctions.autopay',
      },
    });

    this.logger.log(
      `Auction ${params.auctionId} autopay PaymentIntent ${intent.id} status=${intent.status}`,
    );
    return intent;
  }
}
