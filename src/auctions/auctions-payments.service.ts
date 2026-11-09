import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { User } from '../users/entities/user.entity';

export type StripeMethodKind = 'card' | 'ach';

export interface SavedPaymentMethod {
  id: string;
  kind: StripeMethodKind;
  /** Card brand, or bank name for ACH. */
  label: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

const STRIPE_TYPE: Record<StripeMethodKind, 'card' | 'us_bank_account'> = {
  card: 'card',
  ach: 'us_bank_account',
};

/**
 * Stripe wrapper scoped to Hermes Auctions.
 *
 *  - Bidders save a card or US bank account (ACH) through hosted Checkout in
 *    setup mode; nothing is held while the auction runs (card authorizations
 *    expire after 7 days, auctions run 7–21).
 *  - The winner's saved method is charged off-session at close, with an
 *    idempotency key so a retried job can never double-charge.
 *  - Confirmation is pull-based (retrieve the Checkout Session /
 *    PaymentIntent) so a missed webhook can't strand a payment; the webhook
 *    just gets there sooner.
 *
 * Money handling: USD float in / cents out, rounded to the nearest cent.
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

  get client(): Stripe {
    return this.stripe;
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

    const customer = await this.stripe.customers.create(
      {
        email: user.email ?? undefined,
        name: user.username ?? undefined,
        metadata: { userId: user.id, source: 'hermes_auctions' },
      },
      { idempotencyKey: `hermes-customer-${user.id}` },
    );

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
   * Hosted Stripe Checkout in `mode: 'setup'` to save a card or bank
   * account for off-session use. ACH runs through Financial Connections
   * (instant verification), which also collects the mandate.
   */
  async createSetupCheckoutSession(
    userId: string,
    method: StripeMethodKind,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const customerId = await this.getOrCreateCustomerForUser(userId);
    const sep = returnUrl.includes('?') ? '&' : '?';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'setup',
      currency: 'usd',
      customer: customerId,
      payment_method_types: [STRIPE_TYPE[method]],
      ...(method === 'ach'
        ? {
            payment_method_options: {
              us_bank_account: {
                verification_method: 'instant',
                financial_connections: { permissions: ['payment_method'] },
              },
            },
          }
        : {}),
      success_url: `${returnUrl}${sep}hermes_setup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}${sep}hermes_setup=cancel`,
      metadata: { userId, source: 'hermes_auctions', method },
    });

    if (!session.url) {
      throw new BadRequestException('Failed to create setup checkout session');
    }
    return { url: session.url };
  }

  async listSavedMethods(userId: string): Promise<SavedPaymentMethod[]> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.stripeCustomerId) return [];

    const [cards, banks] = await Promise.all([
      this.stripe.paymentMethods.list({
        customer: user.stripeCustomerId,
        type: 'card',
      }),
      this.stripe.paymentMethods.list({
        customer: user.stripeCustomerId,
        type: 'us_bank_account',
      }),
    ]);

    // Newest first so "default to the most recently saved" is index 0.
    const all = [...cards.data, ...banks.data].sort(
      (a, b) => b.created - a.created,
    );
    return all.map((pm) =>
      pm.type === 'card'
        ? {
            id: pm.id,
            kind: 'card' as const,
            label: pm.card?.brand ?? 'card',
            last4: pm.card?.last4 ?? '',
            expMonth: pm.card?.exp_month ?? null,
            expYear: pm.card?.exp_year ?? null,
          }
        : {
            id: pm.id,
            kind: 'ach' as const,
            label: pm.us_bank_account?.bank_name ?? 'Bank account',
            last4: pm.us_bank_account?.last4 ?? '',
            expMonth: null,
            expYear: null,
          },
    );
  }

  /**
   * Resolves the payment method a bid will be charged against, verifying
   * ownership and that its type matches the requested funding method.
   */
  async resolveMethodForBid(
    userId: string,
    kind: StripeMethodKind,
    paymentMethodId?: string,
  ): Promise<string> {
    const saved = await this.listSavedMethods(userId);
    const ofKind = saved.filter((m) => m.kind === kind);
    if (paymentMethodId) {
      const match = ofKind.find((m) => m.id === paymentMethodId);
      if (!match) {
        throw new BadRequestException(
          'That saved payment method was not found on your account.',
        );
      }
      return match.id;
    }
    if (ofKind.length === 0) {
      throw new BadRequestException(
        kind === 'ach'
          ? 'Link a bank account before bidding with ACH.'
          : 'Save a card before bidding with a card.',
      );
    }
    return ofKind[0].id;
  }

  /**
   * Off-session charge for the auction winner. `attempt` scopes the
   * idempotency key: the same (auction, winner, attempt) never charges twice.
   */
  async chargeWinner(params: {
    userId: string;
    paymentMethodId: string;
    kind: StripeMethodKind;
    amountUsd: number;
    auctionId: string;
    attempt: number;
    description: string;
  }): Promise<Stripe.PaymentIntent> {
    const customerId = await this.getOrCreateCustomerForUser(params.userId);

    const amountCents = Math.round(params.amountUsd * 100);
    if (amountCents <= 0) {
      throw new BadRequestException('Charge amount must be > 0');
    }

    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          customer: customerId,
          payment_method: params.paymentMethodId,
          payment_method_types: [STRIPE_TYPE[params.kind]],
          off_session: true,
          confirm: true,
          description: params.description,
          metadata: {
            auctionId: params.auctionId,
            userId: params.userId,
            source: 'hermes.autopay',
          },
        },
        {
          idempotencyKey: `hermes-autopay-${params.auctionId}-${params.userId}-${params.attempt}`,
        },
      );
      this.logger.log(
        `Auction ${params.auctionId} autopay PaymentIntent ${intent.id} status=${intent.status}`,
      );
      return intent;
    } catch (err) {
      // A card decline on an off-session confirm throws but still creates
      // the PaymentIntent; surface it so the caller records the decline.
      const pi = (err as Stripe.errors.StripeCardError)?.payment_intent;
      if (pi) {
        this.logger.warn(
          `Auction ${params.auctionId} autopay declined: ${(err as Error).message}`,
        );
        return pi;
      }
      throw err;
    }
  }

  retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.retrieve(id);
  }

  retrieveCheckoutSession(id: string): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(id);
  }

  /**
   * Hosted Checkout (mode=payment) so a winner whose autopay declined or
   * needs 3DS can pay — same amount we'd have charged, restricted to the
   * method they picked.
   */
  async createRetryPaymentCheckoutSession(params: {
    userId: string;
    auctionId: string;
    amountUsd: number;
    itemName: string;
    returnUrl: string;
    kind: StripeMethodKind;
  }): Promise<{ url: string }> {
    const customerId = await this.getOrCreateCustomerForUser(params.userId);
    const amountCents = Math.round(params.amountUsd * 100);
    if (amountCents <= 0) {
      throw new BadRequestException('Retry amount must be > 0');
    }

    const sep = params.returnUrl.includes('?') ? '&' : '?';
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      payment_method_types: [STRIPE_TYPE[params.kind]],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: params.itemName || 'Hermes Auctions win',
              description: 'Winning bid + buyer premium + shipping',
            },
          },
        },
      ],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        description: `Hermes Auctions ${params.auctionId} (winner payment)`,
        metadata: {
          auctionId: params.auctionId,
          userId: params.userId,
          source: 'hermes.retry',
        },
      },
      success_url: `${params.returnUrl}${sep}hermes_pay=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${params.returnUrl}${sep}hermes_pay=cancel`,
      metadata: {
        type: 'hermes_auction_payment',
        auctionId: params.auctionId,
        userId: params.userId,
      },
    });

    if (!session.url) {
      throw new BadRequestException(
        'Failed to create auction payment checkout session',
      );
    }
    return { url: session.url };
  }

  /** Verifies a Stripe webhook signature against STRIPE_WEBHOOK_SECRET. */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new BadRequestException('Webhook secret not configured');
    }
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }
}
