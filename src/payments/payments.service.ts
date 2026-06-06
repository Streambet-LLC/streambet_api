import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletsService } from '../wallets/wallets.service';
import { CoinPackageService } from '../coin-package/coin-package.service';
import Stripe from 'stripe';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { NotificationService } from 'src/notification/notification.service';
import { WalletGateway } from 'src/wallets/wallets.gateway';
import { randomUUID } from 'crypto';
import { CoinflowPayoutSpeed } from 'src/enums/coinflow-payout-speed.enum';
import { CurrencyType } from 'src/enums/currency.enum';
import { TransactionType } from 'src/enums/transaction-type.enum';
import {
  CoinflowWithdrawKycDto,
  CoinflowWithdrawKycUsDto,
} from './dto/coinflow-withdraw.dto';
import { get } from 'lodash-es';
import { CoinflowWebhookDto } from './dto/coinflow-webhook.dto';
import { WebhookDto } from 'src/webhook/dto/webhook.dto';
import { Repository } from 'typeorm';
import { Transaction } from 'src/wallets/entities/transaction.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { PrizeOrder } from 'src/prize/entities/prize-order.entity';
import { PrizeService } from 'src/prize/prize.service';
import { User } from 'src/users/entities/user.entity';
import { Webhook } from 'src/webhook/entities/webhook.entity';
import { EmailsService } from 'src/emails/email.service';
import { CartService } from 'src/cart/cart.service';
import { AuctionsService } from 'src/auctions/auctions.service';

@Injectable()
export class PaymentsService {
  private stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);
  /** Coinflow API configuration values */
  private readonly coinflowApiUrl: string;
  private readonly coinflowApiKey: string;
  private readonly coinflowDefaultToken: string;
  private readonly coinflowMerchantId: string;
  private readonly coinflowBlockchain: string;
  private readonly coinflowTimeoutMs: number;
  private readonly coinflowClient: AxiosInstance;
  private readonly coinflowMaxRetries: number;
  private readonly coinflowRetryDelayMs: number;

  constructor(
    private configService: ConfigService,
    private walletsService: WalletsService,
    private coinPackageService: CoinPackageService,
    private walletGateway: WalletGateway,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
    @InjectRepository(Transaction)
    private transactionsRepository: Repository<Transaction>,
    @InjectRepository(PrizeOrder)
    private readonly prizeOrderRepository: Repository<PrizeOrder>,
    @Inject(forwardRef(() => PrizeService))
    private readonly prizeService: PrizeService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Webhook)
    private readonly webhookRepository: Repository<Webhook>,
    private readonly emailsService: EmailsService,
    @Inject(forwardRef(() => CartService))
    private readonly cartService: CartService,
    @Inject(forwardRef(() => AuctionsService))
    private readonly auctionsService: AuctionsService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || '',
    );

    this.coinflowApiUrl =
      this.configService.get<string>('coinflow.apiUrl') || '';
    this.coinflowApiKey =
      this.configService.get<string>('coinflow.apiKey') || '';
    this.coinflowDefaultToken =
      this.configService.get<string>('coinflow.defaultToken') || '';
    this.coinflowMerchantId =
      this.configService.get<string>('coinflow.merchantId') || '';
    this.coinflowBlockchain =
      this.configService.get<string>('coinflow.blockchain') || '';
    this.coinflowTimeoutMs =
      this.configService.get<number>('coinflow.timeoutMs') || 10000;
    this.coinflowMaxRetries =
      this.configService.get<number>('coinflow.maxRetries') || 2;
    this.coinflowRetryDelayMs =
      this.configService.get<number>('coinflow.retryDelayMs') || 300;

    this.coinflowClient = axios.create({
      baseURL: this.coinflowApiUrl.replace(/\/+$/, ''),
      timeout: this.coinflowTimeoutMs,
      headers: {
        Authorization: this.coinflowApiKey,
        accept: 'application/json',
      },
    });

    // Response interceptor: simple retry on transient errors (5xx, ECONNRESET, ETIMEDOUT)
    this.coinflowClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config: any = error.config || {};
        config.__retryCount = config.__retryCount || 0;

        const status = error.response?.status;
        const isRetryableStatus = status && status >= 500 && status < 600;
        const isNetworkError = !status;

        if (
          config.__retryCount < this.coinflowMaxRetries &&
          (isRetryableStatus || isNetworkError)
        ) {
          config.__retryCount += 1;
          await new Promise((res) =>
            setTimeout(res, this.coinflowRetryDelayMs),
          );
          return this.coinflowClient.request(config);
        }
        return Promise.reject(error);
      },
    );
  }

  async createCheckoutSession(
    userId: string,
    packageId: string,
    shippingAddress?: any,
    prizeConfigId?: string,
  ) {
    // Define available packages
    type PackageInfo = {
      id: string;
      name: string;
      sweepCoins: number;
      price: number;
    };

    const packages: Record<string, PackageInfo> = {
      small: { id: 'small', name: 'Small Pack', sweepCoins: 500, price: 5 },
      medium: {
        id: 'medium',
        name: 'Medium Pack',
        sweepCoins: 1200,
        price: 10,
      },
      large: { id: 'large', name: 'Large Pack', sweepCoins: 2500, price: 20 },
      premium: {
        id: 'premium',
        name: 'Premium Pack',
        sweepCoins: 6500,
        price: 50,
      },
    };

    // Check if package exists
    if (!packages[packageId]) {
      throw new BadRequestException('Invalid package selection');
    }

    const selectedPackage = packages[packageId];

    // If shippingAddress and prizeConfigId are provided, track this as a buy_attempted prize order
    if (shippingAddress && prizeConfigId) {
      try {
        await this.prizeOrderRepository.save({
          userId,
          prizeConfigurationId: prizeConfigId,
          shippingAddress,
          paymentMethod: 'usd',
          coinsDeducted: 0,
          usdCharged: 0,
          totalPrice: selectedPackage.price,
          status: 'buy_attempted',
        });
      } catch (error) {
        Logger.error(
          `Failed to save prize order with status 'buy_attempted': ${error}`,
          'PaymentsService',
        );
      }
    }

    // Create Stripe Checkout Session. We accept both card and ACH
    // (us_bank_account) so buyers can choose the cheaper bank-transfer
    // path; ACH takes 3-5 business days but the deposit only credits
    // coins after Stripe confirms success via webhook.
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card', 'us_bank_account'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: selectedPackage.name,
              description: `${selectedPackage.sweepCoins} Stream Coins`,
            },
            unit_amount: selectedPackage.price * 100, // in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/purchase-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/shop`,
      metadata: {
        userId,
        packageId,
        sweepCoins: selectedPackage.sweepCoins.toString(),
      },
    });

    return { sessionId: session.id, url: session.url };
  }

  async handleConnectWebhookEvent(signature: string, payload: Buffer) {
    const connectWebhookSecret = this.configService.get<string>(
      'STRIPE_CONNECT_WEBHOOK_SECRET',
    );

    if (!connectWebhookSecret) {
      this.logger.warn(
        'STRIPE_CONNECT_WEBHOOK_SECRET not configured, falling back to main webhook secret',
      );
      return this.handleWebhookEvent(signature, payload);
    }

    let event: Stripe.Event;

    // Verify webhook signature with Connect-specific secret
    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        connectWebhookSecret,
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown webhook error';
      throw new BadRequestException(`Connect Webhook Error: ${errorMessage}`);
    }

    // Store all webhook events for audit
    try {
      await this.webhookRepository.save({
        provider: 'stripe_connect',
        data: JSON.stringify(event),
      });
    } catch (storeErr) {
      this.logger.error(
        `Failed to store Stripe Connect webhook event: ${storeErr}`,
      );
    }

    // Handle Connect-specific event types
    switch (event.type) {
      case 'account.updated':
        await this.handleAccountUpdated(event.data.object);
        break;

      default:
        this.logger.log(`Unhandled Stripe Connect event type: ${event.type}`);
    }

    return { received: true };
  }

  async handleWebhookEvent(signature: string, payload: Buffer) {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    let event: Stripe.Event;

    // Verify webhook signature
    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret || '',
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown webhook error';
      throw new BadRequestException(`Webhook Error: ${errorMessage}`);
    }

    // Store all webhook events for audit
    try {
      await this.webhookRepository.save({
        provider: 'stripe',
        data: JSON.stringify(event),
      });
    } catch (storeErr) {
      this.logger.error(`Failed to store Stripe webhook event: ${storeErr}`);
    }

    // Handle specific event types
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event.data.object);
        break;

      case 'checkout.session.expired':
        await this.handleCheckoutSessionExpired(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event.data.object);
        break;

      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.data.object);
        break;

      case 'checkout.session.async_payment_succeeded':
        // Canonical Stripe event for delayed payment methods (ACH) when
        // funds finally settle. Reuses the same finalize path as
        // payment_intent.succeeded so the order flips payment_processing
        // → paid even if PI events arrive out of order.
        await this.handleAsyncPaymentSucceeded(event.data.object);
        break;

      case 'checkout.session.async_payment_failed':
        await this.handleAsyncPaymentFailed(event.data.object);
        break;

      case 'account.updated':
        await this.handleAccountUpdated(event.data.object);
        break;

      default:
        this.logger.log(`Unhandled Stripe event type: ${event.type}`);
    }

    return { received: true };
  }

  /**
   * Handle successful checkout session — coin packages & prize orders
   */
  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ) {
    // Handle coin package purchases
    if (session.metadata?.userId && session.metadata?.sweepCoins) {
      const userId = session.metadata.userId;
      const sweepCoins = parseInt(session.metadata.sweepCoins, 10);
      const packageName = session.metadata.packageId;

      await this.walletsService.addSweepCoins(
        userId,
        sweepCoins,
        `Purchase of ${packageName} Stream Coin package`,
        'purchase',
      );
    }

    // Handle prize/shop order purchases (server-side confirmation)
    if (session.metadata?.orderId) {
      const orderId = session.metadata.orderId;
      try {
        const order = await this.prizeOrderRepository.findOne({
          where: { id: orderId },
        });
        // Store the payment intent ID for reference (even if already paid)
        if (order && session.payment_intent) {
          const paymentIntentId =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent.id;
          if (!order.stripePaymentIntentId) {
            await this.prizeOrderRepository.update(orderId, {
              stripePaymentIntentId: paymentIntentId,
            });
          }
        }

        if (order) {
          this.logger.log(
            `Stripe webhook: confirming prize order ${orderId} via checkout.session.completed (order.status=${order.status}, session.payment_status=${session.payment_status}, session.id=${session.id})`,
          );
          const transactionSubtotalCents = session.metadata
            ?.transactionSubtotalCents
            ? parseInt(session.metadata.transactionSubtotalCents, 10)
            : undefined;
          const discountCodeId = session.metadata?.discountCodeId || undefined;
          const discountCents = session.metadata?.discountCents || undefined;
          // ACH payments leave session.payment_status='unpaid' (or
          // 'processing') at checkout.session.completed time — funds
          // settle 3–5 business days later via payment_intent.succeeded.
          const paymentStatus: 'succeeded' | 'processing' =
            session.payment_status === 'paid' ? 'succeeded' : 'processing';
          await this.prizeService.handlePaymentSuccess(
            orderId,
            transactionSubtotalCents,
            discountCodeId,
            discountCents,
            session.id,
            paymentStatus,
          );
          this.logger.log(
            `Stripe webhook: prize order ${orderId} successfully confirmed`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Stripe webhook: failed to confirm prize order ${orderId}: ${error}`,
        );
      }
    }

    // Handle auction retry-payment purchases (winner-initiated payment
    // after the off-session autopay charge declined). Keyed off the
    // metadata flag set by `AuctionsPaymentsService.createRetryPaymentCheckoutSession`.
    if (
      session.metadata?.type === 'auction_retry' &&
      session.metadata?.auctionId &&
      session.metadata?.userId
    ) {
      try {
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? '');
        if (!paymentIntentId) {
          this.logger.warn(
            `Auction retry checkout ${session.id} completed without a payment_intent id; skipping finalize`,
          );
        } else {
          await this.auctionsService.handleRetryCheckoutCompleted({
            auctionId: session.metadata.auctionId,
            userId: session.metadata.userId,
            paymentIntentId,
          });
          this.logger.log(
            `Stripe webhook: auction retry session ${session.id} finalized auction ${session.metadata.auctionId}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Stripe webhook: failed to finalize auction retry for session ${session.id}: ${error}`,
        );
      }
    }

    // Handle cart checkout purchases
    if (session.metadata?.type === 'cart_checkout') {
      try {
        this.logger.log(
          `Stripe webhook: processing cart checkout session ${session.id}`,
        );
        await this.cartService.handleCheckoutSuccess(session);
        this.logger.log(
          `Stripe webhook: cart checkout session ${session.id} successfully processed`,
        );
      } catch (error) {
        this.logger.error(
          `Stripe webhook: failed to process cart checkout session ${session.id}: ${error}`,
        );
      }
    }
  }

  /**
   * Handle expired checkout session — mark prize order as cancelled
   */
  private async handleCheckoutSessionExpired(session: Stripe.Checkout.Session) {
    if (!session.metadata?.orderId) return;

    const orderId = session.metadata.orderId;
    try {
      const order = await this.prizeOrderRepository.findOne({
        where: { id: orderId },
        relations: ['user', 'prizeConfiguration'],
      });
      if (!order || order.status === 'paid' || order.status === 'cancelled') {
        return;
      }

      await this.prizeOrderRepository.update(orderId, { status: 'cancelled' });
      this.logger.log(
        `Stripe webhook: prize order ${orderId} cancelled (checkout session expired)`,
      );

      // Notify buyer via email
      if (order.user?.email) {
        const itemName = order.prizeConfiguration?.name || 'your item';
        try {
          await this.emailsService.sendEmailSMTP(
            {
              toAddress: [order.user.email],
              subject: `Your checkout for ${itemName} has expired`,
              params: {
                buyerName: order.user.name || order.user.username,
                itemName,
                orderId: order.id,
                message:
                  'Your checkout session expired before payment was completed. The item is still available in the shop — feel free to try again!',
              },
            },
            'buyer_payment_expired',
          );
        } catch (emailErr) {
          this.logger.error(
            `Failed to send checkout expired email for order ${orderId}: ${emailErr}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Stripe webhook: failed to handle expired session for order ${orderId}: ${error}`,
      );
    }
  }

  /**
   * Handle failed payment intent — notify buyer, do NOT remove item from shop
   */
  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    // Find ALL orders attached to this payment intent. A single-item checkout
    // produces 1 order; a cart checkout produces N orders sharing the intent.
    let orders: PrizeOrder[] = [];
    try {
      orders = await this.prizeOrderRepository.find({
        where: { stripePaymentIntentId: paymentIntent.id },
        relations: ['user', 'prizeConfiguration'],
      });
    } catch {
      // Payment intent ID may not be stored yet
    }
    if (orders.length === 0 && paymentIntent.metadata?.orderId) {
      const o = await this.prizeOrderRepository.findOne({
        where: { id: paymentIntent.metadata.orderId },
        relations: ['user', 'prizeConfiguration'],
      });
      if (o) orders = [o];
    }

    if (orders.length === 0) {
      this.logger.warn(
        `Stripe webhook: no order found for failed payment intent ${paymentIntent.id}`,
      );
      return;
    }

    this.logger.warn(
      `Stripe webhook: payment failed for ${orders.length} order(s) (payment intent ${paymentIntent.id})`,
    );

    // ACH failures on orders already reserved (payment_processing) must be
    // fully reverted (stock, combined coins, status) AND notify seller+buyer.
    // The revert methods now own both emails, so we don't double-send here.
    const pending = orders.filter((o) => o.status === 'payment_processing');
    if (pending.length > 0) {
      // Detect cart the same way as the settle path: shared session + cart metadata.
      const sessionId = pending[0].stripeSessionId;
      let isCart = false;
      if (sessionId && pending.length > 1) {
        isCart = true;
      } else if (sessionId) {
        try {
          const session =
            await this.stripe.checkout.sessions.retrieve(sessionId);
          isCart = session.metadata?.type === 'cart_checkout';
        } catch (err) {
          this.logger.warn(
            `handlePaymentIntentFailed: could not retrieve session ${sessionId} to detect cart: ${err}`,
          );
        }
      }

      try {
        if (isCart && sessionId) {
          await this.cartService.handleCartAchFailed(sessionId);
        } else {
          for (const order of pending) {
            await this.prizeService.handleAchPaymentFailed(order.id);
          }
        }
      } catch (revertErr) {
        this.logger.error(
          `Failed to revert ACH-failed payment intent ${paymentIntent.id}: ${revertErr}`,
        );
      }
      return;
    }

    // Pre-settlement failure (orders still buy_attempted/pending — no stock
    // reserved). Just let the buyer know their payment didn't go through.
    const failureMessage =
      paymentIntent.last_payment_error?.message ||
      'Your payment could not be processed.';
    for (const order of orders) {
      if (!order.user?.email) continue;
      const itemName = order.prizeConfiguration?.name || 'your item';
      try {
        await this.emailsService.sendEmailSMTP(
          {
            toAddress: [order.user.email],
            subject: `Payment failed for ${itemName}`,
            params: {
              buyerName: order.user.name || order.user.username,
              itemName,
              orderId: order.id,
              message: `${failureMessage} The item is still available — please try again or use a different payment method.`,
            },
          },
          'buyer_payment_failed',
        );
      } catch (emailErr) {
        this.logger.error(
          `Failed to send payment failure email for order ${order.id}: ${emailErr}`,
        );
      }
    }
  }

  /**
   * Handle successful payment intent — ACH settlement. For card payments
   * Stripe also fires this, but the order is already in 'paid' state and
   * handleAchPaymentSettled is a no-op for any non-payment_processing
   * order.
   */
  private async handlePaymentIntentSucceeded(
    paymentIntent: Stripe.PaymentIntent,
  ) {
    // Find ALL prize orders attached to this payment intent. A single-item
    // checkout produces 1 order; a cart checkout produces N orders that
    // all share the same payment_intent.
    let orders: PrizeOrder[] = [];
    try {
      orders = await this.prizeOrderRepository.find({
        where: { stripePaymentIntentId: paymentIntent.id },
      });
    } catch {
      // ignore
    }
    if (orders.length === 0 && paymentIntent.metadata?.orderId) {
      const o = await this.prizeOrderRepository.findOne({
        where: { id: paymentIntent.metadata.orderId },
      });
      if (o) orders = [o];
    }
    if (orders.length === 0) {
      // Not a prize/cart payment intent (e.g. coin package, subscription).
      return;
    }

    // Skip if none are in payment_processing — card flows already
    // finalized at checkout.session.completed time.
    const pending = orders.filter((o) => o.status === 'payment_processing');
    if (pending.length === 0) return;

    // Decide cart vs single. Cart orders share a stripeSessionId AND the
    // session metadata.type === 'cart_checkout'.
    const sessionId = pending[0].stripeSessionId;
    let isCart = false;
    if (sessionId && pending.length > 1) {
      isCart = true;
    } else if (sessionId) {
      try {
        const session =
          await this.stripe.checkout.sessions.retrieve(sessionId);
        isCart = session.metadata?.type === 'cart_checkout';
      } catch (err) {
        this.logger.warn(
          `handlePaymentIntentSucceeded: could not retrieve session ${sessionId} to detect cart: ${err}`,
        );
      }
    }

    try {
      if (isCart && sessionId) {
        await this.cartService.handleCartAchSettled(sessionId);
        this.logger.log(
          `Stripe webhook: ACH settled for cart session ${sessionId} (payment intent ${paymentIntent.id})`,
        );
      } else {
        for (const order of pending) {
          await this.prizeService.handleAchPaymentSettled(order.id);
        }
        this.logger.log(
          `Stripe webhook: ACH settled for ${pending.length} order(s) (payment intent ${paymentIntent.id})`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Stripe webhook: failed to settle ACH for payment intent ${paymentIntent.id}: ${err}`,
      );
    }
  }

  /**
   * Reconcile prize orders stuck in `payment_processing` against Stripe.
   *
   * ACH (us_bank_account) orders flip `payment_processing -> paid` only when
   * the `payment_intent.succeeded` / `checkout.session.async_payment_succeeded`
   * webhook is received AND processed. If that webhook was never delivered
   * (endpoint not subscribed to the event, deploy gap, transient 5xx that
   * Stripe stopped retrying, etc.) the order is stranded forever — funds have
   * settled at Stripe but our DB never hears about it.
   *
   * This polls Stripe for the *actual* PaymentIntent status of every stuck
   * order and re-drives the exact same finalize paths the webhook would have:
   *   - PI `succeeded`  -> {@link handlePaymentIntentSucceeded} (flips to paid,
   *     emails the seller, handles cart vs single).
   *   - PI `canceled`   -> {@link handlePaymentIntentFailed} (reverts stock,
   *     refunds combined CadeCoins, deletes redemption, emails buyer/seller).
   *   - anything else (still processing / requires action) -> left untouched.
   *
   * Every downstream handler is idempotent, so running this alongside live
   * webhooks (or repeatedly) is safe.
   *
   * @param options.olderThanMinutes Only consider orders created at least this
   *   many minutes ago (default 0 = all). Lets the cron skip orders that are
   *   still mid-checkout.
   * @param options.limit Max number of stuck orders to scan in one pass.
   */
  async reconcileProcessingAchOrders(options?: {
    olderThanMinutes?: number;
    limit?: number;
  }): Promise<{
    scanned: number;
    settled: number;
    failed: number;
    stillProcessing: number;
    skippedNoPaymentIntent: number;
    errors: number;
  }> {
    const olderThanMinutes = options?.olderThanMinutes ?? 0;
    const limit = options?.limit ?? 200;

    const qb = this.prizeOrderRepository
      .createQueryBuilder('o')
      .where('o.status = :status', { status: 'payment_processing' })
      .orderBy('o.createdAt', 'ASC')
      .take(limit);

    if (olderThanMinutes > 0) {
      const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
      qb.andWhere('o.createdAt <= :cutoff', { cutoff });
    }

    const stuckOrders = await qb.getMany();

    const summary = {
      scanned: stuckOrders.length,
      settled: 0,
      failed: 0,
      stillProcessing: 0,
      skippedNoPaymentIntent: 0,
      errors: 0,
    };

    if (stuckOrders.length === 0) {
      return summary;
    }

    this.logger.log(
      `ACH reconciler: scanning ${stuckOrders.length} order(s) in payment_processing`,
    );

    // Resolve a PaymentIntent id for each order, then dedupe — cart
    // checkouts share a single PaymentIntent across N orders, so we only
    // need to retrieve + drive each PI once.
    const piIds = new Set<string>();
    for (const order of stuckOrders) {
      try {
        const piId = await this.resolvePaymentIntentIdForOrder(order);
        if (piId) {
          piIds.add(piId);
        } else {
          summary.skippedNoPaymentIntent += 1;
          this.logger.warn(
            `ACH reconciler: order ${order.id} has no resolvable PaymentIntent; skipping`,
          );
        }
      } catch (err) {
        summary.errors += 1;
        this.logger.error(
          `ACH reconciler: failed to resolve PaymentIntent for order ${order.id}: ${err}`,
        );
      }
    }

    for (const piId of piIds) {
      try {
        const paymentIntent =
          await this.stripe.paymentIntents.retrieve(piId);

        if (paymentIntent.status === 'succeeded') {
          await this.handlePaymentIntentSucceeded(paymentIntent);
          summary.settled += 1;
          this.logger.log(
            `ACH reconciler: settled order(s) for PaymentIntent ${piId} (Stripe status=succeeded)`,
          );
        } else if (paymentIntent.status === 'canceled') {
          await this.handlePaymentIntentFailed(paymentIntent);
          summary.failed += 1;
          this.logger.warn(
            `ACH reconciler: reverted order(s) for PaymentIntent ${piId} (Stripe status=canceled)`,
          );
        } else {
          summary.stillProcessing += 1;
          this.logger.log(
            `ACH reconciler: PaymentIntent ${piId} still ${paymentIntent.status}; leaving order(s) in payment_processing`,
          );
        }
      } catch (err) {
        summary.errors += 1;
        this.logger.error(
          `ACH reconciler: failed to reconcile PaymentIntent ${piId}: ${err}`,
        );
      }
    }

    this.logger.log(
      `ACH reconciler: done — scanned=${summary.scanned} settled=${summary.settled} failed=${summary.failed} stillProcessing=${summary.stillProcessing} skippedNoPaymentIntent=${summary.skippedNoPaymentIntent} errors=${summary.errors}`,
    );

    return summary;
  }

  /**
   * Resolve the Stripe PaymentIntent id for a prize order. Prefers the
   * stored `stripePaymentIntentId`; falls back to retrieving the Checkout
   * Session (and backfills the id on the order so later passes are cheap).
   */
  private async resolvePaymentIntentIdForOrder(
    order: PrizeOrder,
  ): Promise<string | null> {
    if (order.stripePaymentIntentId) {
      return order.stripePaymentIntentId;
    }
    if (!order.stripeSessionId) {
      return null;
    }

    const session = await this.stripe.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    const piId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    if (piId) {
      try {
        await this.prizeOrderRepository.update(order.id, {
          stripePaymentIntentId: piId,
        });
      } catch (err) {
        this.logger.warn(
          `ACH reconciler: failed to backfill stripePaymentIntentId on order ${order.id}: ${err}`,
        );
      }
    }
    return piId;
  }

  /**
   * Handle checkout.session.async_payment_succeeded — canonical event for
   * delayed payment methods (ACH) when funds settle. Functionally
   * equivalent to payment_intent.succeeded for our purposes, but we
   * dispatch through the same code paths to be safe against duplicate
   * webhooks (idempotency is enforced inside handleAchPaymentSettled /
   * handleCartAchSettled).
   */
  private async handleAsyncPaymentSucceeded(
    session: Stripe.Checkout.Session,
  ) {
    this.logger.log(
      `Stripe webhook: async_payment_succeeded session=${session.id} payment_status=${session.payment_status}`,
    );

    // Cart checkout
    if (session.metadata?.type === 'cart_checkout') {
      try {
        await this.cartService.handleCartAchSettled(session.id);
      } catch (err) {
        this.logger.error(
          `async_payment_succeeded: failed to settle cart session ${session.id}: ${err}`,
        );
      }
      return;
    }

    // Single prize order
    if (session.metadata?.orderId) {
      try {
        await this.prizeService.handleAchPaymentSettled(
          session.metadata.orderId,
        );
      } catch (err) {
        this.logger.error(
          `async_payment_succeeded: failed to settle order ${session.metadata.orderId}: ${err}`,
        );
      }
    }
  }

  /**
   * Handle checkout.session.async_payment_failed — ACH debit bounced.
   * Reverts the order (stock, redemption, CadeCoins refund) and notifies
   * the seller.
   */
  private async handleAsyncPaymentFailed(session: Stripe.Checkout.Session) {
    this.logger.warn(
      `Stripe webhook: async_payment_failed session=${session.id} payment_status=${session.payment_status}`,
    );

    if (session.metadata?.type === 'cart_checkout' && session.metadata.orderIds) {
      const orderIds = session.metadata.orderIds.split(',');
      for (const orderId of orderIds) {
        try {
          await this.prizeService.handleAchPaymentFailed(orderId);
        } catch (err) {
          this.logger.error(
            `async_payment_failed: failed to revert order ${orderId}: ${err}`,
          );
        }
      }
      return;
    }

    if (session.metadata?.orderId) {
      try {
        await this.prizeService.handleAchPaymentFailed(
          session.metadata.orderId,
        );
      } catch (err) {
        this.logger.error(
          `async_payment_failed: failed to revert order ${session.metadata.orderId}: ${err}`,
        );
      }
    }
  }

  /**
   * Handle Stripe Connect account.updated — gate seller on full verification
   */
  private async handleAccountUpdated(account: Stripe.Account) {
    // Require full verification: details submitted + can accept charges + can receive payouts
    if (
      !account.details_submitted ||
      !account.charges_enabled ||
      !account.payouts_enabled
    ) {
      return;
    }

    const user = await this.userRepository.findOne({
      where: { stripeAccountId: account.id },
    });

    if (!user) {
      this.logger.warn(`No user found for Stripe account ${account.id}`);
      return;
    }

    const updates: Partial<{
      sellerOnboardingCompleted: boolean;
      stripeAccountConnected: boolean;
      applicationFeePercent: number;
    }> = {};

    if (!user.sellerOnboardingCompleted) {
      updates.sellerOnboardingCompleted = true;
    }
    if (!user.stripeAccountConnected) {
      updates.stripeAccountConnected = true;
    }
    // Ensure the seller fee is always set to the current default
    if (user.applicationFeePercent !== 2) {
      updates.applicationFeePercent = 2;
    }

    if (Object.keys(updates).length > 0) {
      await this.userRepository.update(user.id, updates);
      this.logger.log(
        `Seller onboarding flags updated for user ${user.id}: ${JSON.stringify(updates)} (charges_enabled + payouts_enabled)`,
      );
    }
  }

  async createAutoReloadSession(userId: string, amount: number) {
    // Check if amount is valid
    if (![5, 10, 15, 20].includes(amount)) {
      throw new BadRequestException('Invalid auto-reload amount');
    }

    // Get sweep coins based on amount
    const sweepCoinsMap: Record<number, number> = {
      5: 500,
      10: 1200,
      15: 1800,
      20: 2500,
    };

    const sweepCoins = sweepCoinsMap[amount];

    try {
      // Create payment intent
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: amount * 100, // in cents
        currency: 'usd',
        payment_method_types: ['card'],
        metadata: {
          userId,
          sweepCoins: sweepCoins.toString(),
          autoReload: 'true',
        },
      });

      return { clientSecret: paymentIntent.client_secret };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown Stripe error';
      throw new BadRequestException(
        `Failed to create payment intent: ${errorMessage}`,
      );
    }
  }

  async handleAutoReloadSuccess(paymentIntentId: string) {
    try {
      // Retrieve the payment intent
      const paymentIntent =
        await this.stripe.paymentIntents.retrieve(paymentIntentId);

      // Check if it's valid and successful
      if (
        paymentIntent.status === 'succeeded' &&
        paymentIntent.metadata?.userId &&
        paymentIntent.metadata?.sweepCoins &&
        paymentIntent.metadata?.autoReload === 'true'
      ) {
        const userId = paymentIntent.metadata.userId;
        const sweepCoins = parseInt(paymentIntent.metadata.sweepCoins, 10);

        // Add sweep coins to user's wallet
        await this.walletsService.addSweepCoins(
          userId,
          sweepCoins,
          `Auto-reload purchase of ${sweepCoins} Stream Coins`,
          'purchase',
        );
        return { success: true, sweepCoins };
      }

      throw new BadRequestException('Invalid or unsuccessful payment');
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown Stripe error';
      throw new BadRequestException(
        `Failed to process payment: ${errorMessage}`,
      );
    }
  }

  /**
   * Fetches a Coinflow session key for the given user.
   *
   * @param userId - The application user ID.
   * @returns The session key payload returned by Coinflow.
   * @throws BadRequestException If configuration is missing or the upstream request fails.
   */
  async getCoinflowSessionKey(userId: string) {
    if (!this.coinflowApiUrl || !this.coinflowApiKey) {
      throw new BadRequestException(
        'Coinflow configuration missing. Please set COINFLOW_API_URL and COINFLOW_API_KEY',
      );
    }

    try {
      const { data } = await this.coinflowClient.get('/api/auth/session-key', {
        headers: {
          'x-coinflow-auth-user-id': userId,
        },
      });

      return data;
    } catch (error) {
      throw this.mapCoinflowError(
        error,
        'Failed to fetch Coinflow session key',
      );
    }
  }

  /**
   * Retrieves the Coinflow withdraw payload for the given user.
   *
   * @param userId - The application user ID.
   * @param redirectLink - Redirect Link for additional verification.
   * @returns The withdraw payload returned by Coinflow.
   * @throws BadRequestException If configuration is missing or the upstream request fails.
   */
  async getCoinflowWithdraw(userId: string, redirectLink?: string) {
    if (!this.coinflowApiUrl || !this.coinflowApiKey) {
      throw new BadRequestException(
        'Coinflow configuration missing. Please set COINFLOW_API_URL and COINFLOW_API_KEY',
      );
    }

    try {
      const { data } = await this.coinflowClient.get('/api/withdraw', {
        params: {
          redirectLink,
        },
        headers: {
          'x-coinflow-auth-user-id': userId,
        },
      });

      return data;
    } catch (error) {
      if (
        error.status === 451 &&
        get(error, 'response.data.verificationLink')
      ) {
        return {
          status: 451,
          data: {
            verificationLink: get(error, 'response.data.verificationLink'),
          },
        };
      }

      throw this.mapCoinflowError(
        error,
        'Failed to fetch Coinflow withdraw data',
      );
    }
  }

  /**
   * Retrieves a withdraw quote from Coinflow for the given amount and user.
   *
   * @param amount - The withdraw amount.
   * @param userId - The application user ID.
   * @returns The quote payload returned by Coinflow.
   * @throws BadRequestException If configuration is missing or the upstream request fails.
   */
  async getCoinflowWithdrawQuote(amount: number, userId: string) {
    if (
      !this.coinflowApiUrl ||
      !this.coinflowApiKey ||
      !this.coinflowDefaultToken ||
      !this.coinflowMerchantId ||
      !this.coinflowBlockchain
    ) {
      throw new BadRequestException(
        'Coinflow configuration missing. Please set COINFLOW_API_URL, COINFLOW_API_KEY, COINFLOW_DEFAULT_TOKEN, COINFLOW_MERCHANT_ID, and COINFLOW_BLOCKCHAIN',
      );
    }

    try {
      const { data } = await this.coinflowClient.get('/api/withdraw/quote', {
        params: {
          token: this.coinflowDefaultToken,
          amount,
          merchantId: this.coinflowMerchantId,
        },
        headers: {
          'x-coinflow-auth-blockchain': this.coinflowBlockchain,
          'x-coinflow-auth-user-id': userId,
        },
      });

      return data;
    } catch (error) {
      throw this.mapCoinflowError(
        error,
        'Failed to fetch Coinflow withdraw quote',
      );
    }
  }

  /**
   * Deletes a Coinflow withdrawer bank account for the given token and user.
   *
   * @param token - The Coinflow withdrawer account token to delete.
   * @param userId - The application user ID.
   * @returns The deletion result payload returned by Coinflow.
   * @throws BadRequestException If configuration is missing, the token is invalid, or the upstream request fails.
   */
  async deleteCoinflowWithdrawerAccount(token: string, userId: string) {
    if (!this.coinflowApiUrl || !this.coinflowApiKey) {
      throw new BadRequestException(
        'Coinflow configuration missing. Please set COINFLOW_API_URL and COINFLOW_API_KEY',
      );
    }
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new BadRequestException('Missing or invalid token');
    }

    try {
      // Fetch withdrawer details and ensure the token exists under bankAccounts
      const withdrawer = await this.getCoinflowWithdraw(userId);

      // Find the bankAccounts array somewhere in the withdrawer payload
      const getBankAccountsArray = (root: any): any[] | undefined => {
        if (!root || typeof root !== 'object') return undefined;
        const queue: any[] = [root];
        while (queue.length > 0) {
          const current = queue.shift();
          if (current && typeof current === 'object') {
            if (Array.isArray(current.bankAccounts)) {
              return current.bankAccounts as any[];
            }
            for (const value of Object.values(current)) {
              if (value && typeof value === 'object') queue.push(value);
            }
          }
        }
        return undefined;
      };

      const bankAccounts = getBankAccountsArray(withdrawer);
      if (!Array.isArray(bankAccounts) || bankAccounts.length === 0) {
        throw new NotFoundException('No bank accounts found for withdrawer');
      }

      const normalizedToken = token.trim();
      const tokenExists = bankAccounts.some((acc: any) => {
        if (!acc || typeof acc !== 'object') return false;
        const candidates = [
          acc.token,
          acc.accountToken,
          acc.bankAccountToken,
          acc.id,
        ];
        return candidates.some(
          (v) => typeof v === 'string' && v.trim() === normalizedToken,
        );
      });

      if (!tokenExists) {
        throw new NotFoundException(
          'Bank account token not found for withdrawer',
        );
      }

      const { data } = await this.coinflowClient.delete(
        `/api/withdraw/account/${token}`,
        {
          headers: {
            'x-coinflow-auth-user-id': userId,
          },
        },
      );

      return data;
    } catch (error) {
      // Keep previously thrown HttpExceptions (e.g., 400/404) intact.
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.mapCoinflowError(
        error,
        'Failed to delete Coinflow withdrawer account',
      );
    }
  }

  /** Maps an Axios error from Coinflow into a meaningful HttpException. */
  private mapCoinflowError(error: unknown, prefix: string): HttpException {
    const axiosError = error as AxiosError<any>;
    const status = axiosError.response?.status;
    const responseData = axiosError.response?.data;
    const safeDetail =
      (responseData && typeof responseData.message === 'string'
        ? responseData.message
        : typeof responseData === 'string'
          ? responseData
          : axiosError.message) || 'Unknown Coinflow error';

    // If details exist, append them
    const details =
      responseData && responseData.details ? `, ${responseData.details}` : '';

    const message = `${prefix}: ${safeDetail}${details}`;
    const httpStatus =
      typeof status === 'number' && status >= 400 && status < 600
        ? status
        : HttpStatus.BAD_GATEWAY;
    return new HttpException(message, httpStatus);
  }

  /**
   * Handle Coinflow webhook events from queue
   */
  async handleCoinflowWebhookEvent(webhook: WebhookDto) {
    try {
      const payload: CoinflowWebhookDto = JSON.parse(webhook.data);
      const { category } = payload;

      if (category === 'Purchase') {
        this.handleCoinflowWebhookPurchase(webhook.webhookId, payload);
      } else if (category === 'Withdraw') {
        this.handleCoinflowWebhookWithdraw(webhook.webhookId, payload);
      }
    } catch (error) {
      if (error instanceof HttpException) {
        Logger.error(
          `Failed to process Coinflow webhook ${webhook.webhookId}: ${error}`,
          PaymentsService.name,
        );
        return;
      }

      Logger.error(
        `Failed to process Coinflow webhook ${webhook.webhookId}: ${(error as Error)?.message}`,
        PaymentsService.name,
      );
      return;
    }
  }

  /**
   * Handle Coinflow purchase webhook events
   */
  async handleCoinflowWebhookPurchase(
    webhookId: string,
    payload: CoinflowWebhookDto,
  ) {
    try {
      const { eventType, category, data } = payload;

      if (category !== 'Purchase') return;

      if (eventType === 'Settled') {
        const userId = data.rawCustomerId as string | undefined;
        const coinPackageId = get(data, 'webhookInfo.coin_package_id') as
          | string
          | undefined;
        const webhookEnv = get(data, 'webhookInfo.env') as string | undefined;
        const relatedEntityId = data.id as string | undefined;

        if (!userId) {
          throw new BadRequestException('Missing userId (rawCustomerId)');
        }

        if (!coinPackageId) {
          throw new BadRequestException(
            'Missing coinPackageId (webhookInfo.coin_package_id)',
          );
        }

        if (!relatedEntityId) {
          throw new BadRequestException('Missing dataId (data.id)');
        }

        const expectedEnv = (
          this.configService.get<string>('coinflow.webhookEnv') || 'dev'
        )
          .trim()
          .toLowerCase();
        const receivedEnv = webhookEnv.trim().toLowerCase();

        if (expectedEnv !== receivedEnv) {
          throw new BadRequestException(
            `mismatch (received="${receivedEnv ?? 'undefined'}", expected="${expectedEnv}"'`,
          );
        }

        const coinPackage =
          await this.coinPackageService.findById(coinPackageId);

        if (!coinPackage) {
          throw new BadRequestException('Coin package provided was not found');
        }

        const relatedEntityType = 'coinflow';

        // If we've already processed this purchase for a given currency, skip credit for that currency
        // Gold coins
        if (Number(coinPackage.goldCoinCount) > 0) {
          const exists = relatedEntityId
            ? await this.walletsService.hasTransactionForRelatedEntity(
                relatedEntityId,
                TransactionType.PURCHASE,
                relatedEntityType,
                CurrencyType.GOLD_COINS,
              )
            : false;
          if (!exists) {
            await this.walletsService.updateBalance(
              userId,
              Number(coinPackage.goldCoinCount),
              CurrencyType.GOLD_COINS,
              TransactionType.PURCHASE,
              `Purchase of ${coinPackage.name}: ${coinPackage.goldCoinCount} gold coins`,
              {
                coinPackageId: coinPackage.id,
                source: 'coinflow',
                usdAmount: Number(coinPackage.totalAmount),
              },
              { relatedEntityId, relatedEntityType },
            );
          }
        }

        // Sweep coins
        if (Number(coinPackage.sweepCoinCount) > 0) {
          const exists = relatedEntityId
            ? await this.walletsService.hasTransactionForRelatedEntity(
                relatedEntityId,
                TransactionType.PURCHASE,
                relatedEntityType,
                CurrencyType.SWEEP_COINS,
              )
            : false;
          if (!exists) {
            await this.walletsService.updateBalance(
              userId,
              Number(coinPackage.sweepCoinCount),
              CurrencyType.SWEEP_COINS,
              TransactionType.BONUS,
              `Purchase of ${coinPackage.name}: ${coinPackage.sweepCoinCount} bonus Stream Coins`,
              { coinPackageId: coinPackage.id, source: 'coinflow' },
              { relatedEntityId, relatedEntityType },
            );
          }
        }

        Logger.log(
          `Coinflow settled credited for user ${userId} and package ${coinPackageId}`,
        );

        // Emit socket notification to all of the user's active connections
        const updatedWallet = await this.walletsService.findByUserId(userId);
        this.walletGateway.emitPurchaseSettled(userId, {
          message: `Purchase successful: ${coinPackage.name}`,
          updatedWalletBalance: {
            goldCoins: updatedWallet.goldCoins,
            sweepCoins: updatedWallet.sweepCoins,
          },
          coinPackage: {
            id: coinPackage.id,
            name: coinPackage.name,
            sweepCoins: Number(coinPackage.sweepCoinCount) || 0,
            goldCoins: Number(coinPackage.goldCoinCount) || 0,
          },
        });
        // Send email notification to the user
        await this.notificationService.sendSMTPForCoinPurchaseSuccess(
          userId,
          Number(coinPackage.goldCoinCount) || 0,
          Number(coinPackage.sweepCoinCount) || 0,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        Logger.error(
          `Failed to process Coinflow purchase webhook ${webhookId}: ${error}`,
          PaymentsService.name,
        );
        return;
      }

      Logger.error(
        `Failed to process Coinflow purchase webhook ${webhookId}: ${(error as Error)?.message}`,
        PaymentsService.name,
      );
      return;
    }
  }

  /**
   * Handle Coinflow withdraw webhook events
   */
  async handleCoinflowWebhookWithdraw(
    webhookId: string,
    payload: CoinflowWebhookDto,
  ) {
    try {
      const { eventType, category, data } = payload;

      if (
        category !== 'Withdraw' ||
        (eventType !== 'Withdraw Success' && eventType !== 'Withdraw Failure')
      )
        return;

      const relatedEntityId = data.signature as string | undefined;
      const relatedEntityType = 'coinflow';

      if (!relatedEntityId) {
        throw new BadRequestException('Missing signature (data.signature)');
      }

      const clauses = [
        TransactionType.WITHDRAWAL_PENDING,
        TransactionType.WITHDRAWAL_SUCCESS,
        TransactionType.WITHDRAWAL_FAILED,
      ].map((type) => ({
        relatedEntityId,
        type,
        relatedEntityType,
        currencyType: CurrencyType.SWEEP_COINS,
      }));

      const withdrawals = await this.transactionsRepository.find({
        where: clauses,
      });

      const initialTransaction = withdrawals.find(
        (withdrawal) => withdrawal.type === TransactionType.WITHDRAWAL_PENDING,
      );

      if (!initialTransaction) {
        Logger.warn(
          `Ignoring coinflow webhook ${webhookId}: provided signature does not match any initial transaction`,
        );
        return;
      }

      if (
        withdrawals.filter(
          (withdrawal) =>
            withdrawal.type === TransactionType.WITHDRAWAL_SUCCESS ||
            withdrawal.type === TransactionType.WITHDRAWAL_FAILED,
        ).length > 0
      ) {
        Logger.warn(
          `Ignoring coinflow webhook ${webhookId}: provided signature has already been completed`,
        );
        return;
      }

      await this.walletsService.updateBalance(
        initialTransaction.userId,
        eventType === 'Withdraw Success'
          ? 0
          : initialTransaction.metadata.sweepCoins,
        CurrencyType.SWEEP_COINS,
        eventType === 'Withdraw Success'
          ? TransactionType.WITHDRAWAL_SUCCESS
          : TransactionType.WITHDRAWAL_FAILED,
        `Withdrawal of ${initialTransaction.metadata.sweepCoins} Stream Coins to $${initialTransaction.metadata.usdAmount} ${
          eventType === 'Withdraw Success' ? 'was successful' : 'failed'
        }`,
        initialTransaction.metadata,
        { relatedEntityId, relatedEntityType },
      );

      // Emit socket notification to all of the user's active connections
      if (eventType === 'Withdraw Success') {
        this.walletGateway.emitWithdrawSuccess(initialTransaction.userId, {
          message: `Withdraw Success: ${initialTransaction.metadata.sweepCoins} Stream Coins`,
          sweepCoins: initialTransaction.metadata.sweepCoins,
        });
      } else if (eventType === 'Withdraw Failure') {
        this.walletGateway.emitWithdrawFailed(initialTransaction.userId, {
          message: `Withdraw Failed: ${initialTransaction.metadata.sweepCoins} Stream Coins`,
          sweepCoins: initialTransaction.metadata.sweepCoins,
        });
      }

      Logger.log(
        `Coinflow ${eventType} for user ${initialTransaction.userId} with ${initialTransaction.metadata.sweepCoins} Stream Coins to $${initialTransaction.metadata.usdAmount}`,
      );

      // Send email notification to the user
      // await this.notificationService.sendSMTPForCoinPurchaseSuccess(
      //   userId,
      //   Number(coinPackage.goldCoinCount) || 0,
      //   Number(coinPackage.sweepCoinCount) || 0,
      // );
    } catch (error) {
      if (error instanceof HttpException) {
        Logger.error(
          `Failed to process Coinflow withdraw webhook ${webhookId}: ${error}`,
          PaymentsService.name,
        );
        return;
      }

      Logger.error(
        `Failed to process Coinflow withdraw webhook ${webhookId}: ${(error as Error)?.message}`,
        PaymentsService.name,
      );
      return;
    }
  }

  /**
   * Initiates a delegated payout (withdrawal) via Coinflow for the authenticated user.
   *
   * Flow:
   * - Validates Coinflow configuration.
   * - Converts requested sweep coins to USD and validates balance/thresholds.
   * - Calls Coinflow merchant delegated payout endpoint.
   */
  async initiateCoinflowDelegatedPayout(
    userId: string,
    params: {
      coins: number;
      account: string;
      speed: CoinflowPayoutSpeed;
    },
  ) {
    if (
      !this.coinflowApiUrl ||
      !this.coinflowApiKey ||
      !this.coinflowDefaultToken ||
      !this.coinflowMerchantId
    ) {
      throw new BadRequestException(
        'Coinflow configuration missing. Please set COINFLOW_API_URL, COINFLOW_API_KEY, COINFLOW_DEFAULT_TOKEN, COINFLOW_MERCHANT_ID, and COINFLOW_BLOCKCHAIN',
      );
    }

    const coins = Number(params?.coins);
    if (!Number.isInteger(coins) || coins <= 0) {
      throw new BadRequestException('Invalid coins value');
    }
    if (
      !params?.account ||
      typeof params.account !== 'string' ||
      !params.account.trim()
    ) {
      throw new BadRequestException('Missing or invalid payout account token');
    }
    if (!params?.speed) {
      throw new BadRequestException('Missing payout speed');
    }

    try {
      // Convert coins to USD and validate balance and minimum thresholds
      const { dollars } = await this.walletsService.convertSweepCoinsToDollars(
        userId,
        coins,
      );

      const idempotencyKey = randomUUID();

      // Call Coinflow delegated payout endpoint (amount in cents)
      const cents = Math.round(Number(dollars) * 100);
      const { data } = await this.coinflowClient.post(
        '/api/merchant/withdraws/payout/delegated',
        {
          amount: { cents },
          speed: params.speed,
          account: params.account,
          userId,
          idempotencyKey,
        },
      );

      await this.walletsService.updateBalance(
        userId,
        -params.coins,
        CurrencyType.SWEEP_COINS,
        TransactionType.WITHDRAWAL_PENDING,
        `Withdrawal of ${params.coins} Stream Coins to $${dollars} initiated`,
        { sweepCoins: params.coins, source: 'coinflow', usdAmount: dollars },
        { relatedEntityId: data.signature, relatedEntityType: 'coinflow' },
      );

      return {
        amountOutUSD: dollars,
        amountOutCents: cents,
        coins,
        speed: params.speed,
        account: params.account,
        idempotencyKey,
        coinflow: data,
      };
    } catch (error) {
      if (
        error.status === 451 &&
        get(error, 'response.data.verificationLink')
      ) {
        return {
          status: 451,
          data: {
            verificationLink: get(error, 'response.data.verificationLink'),
          },
        };
      }
      throw this.mapCoinflowError(error, 'Failed to initiate withdraw');
    }
  }

  async registerUserKyc(userId: string, params: CoinflowWithdrawKycDto) {
    if (
      !this.coinflowApiUrl ||
      !this.coinflowApiKey ||
      !this.coinflowMerchantId
    ) {
      throw new BadRequestException(
        'Coinflow configuration missing. Please set COINFLOW_API_URL, COINFLOW_API_KEY, and COINFLOW_MERCHANT_ID',
      );
    }

    try {
      const { data } = await this.coinflowClient.post(
        '/api/withdraw/kyc',
        {
          merchantId: this.coinflowMerchantId,
          redirectLink: params.redirectLink,
          email: params.email,
          country: params.country,
        },
        {
          headers: {
            'x-coinflow-auth-user-id': userId,
          },
        },
      );

      return data;
    } catch (error) {
      if (
        error.status === 451 &&
        get(error, 'response.data.verificationLink')
      ) {
        return {
          status: 451,
          data: {
            verificationLink: get(error, 'response.data.verificationLink'),
          },
        };
      }

      throw this.mapCoinflowError(
        error,
        'Failed to register user as withdrawer',
      );
    }
  }

  async registerUserKycUs(userId: string, params: CoinflowWithdrawKycUsDto) {
    if (!this.coinflowApiUrl || !this.coinflowApiKey) {
      throw new BadRequestException(
        'Coinflow configuration missing. Please set COINFLOW_API_URL, COINFLOW_API_KEY, and COINFLOW_MERCHANT_ID',
      );
    }

    try {
      const { data } = await this.coinflowClient.post(
        '/api/withdraw/kyc',
        {
          merchantId: this.coinflowMerchantId,
          redirectLink: params.redirectLink,
          info: {
            email: params.email,
            firstName: params.firstName,
            surName: params.lastName,
            physicalAddress: params.address,
            city: params.city,
            state: params.state,
            zip: params.zip,
            country: params.country,
            dob: params.dob,
            ssn: params.ssn,
          },
        },
        {
          headers: {
            'x-coinflow-auth-user-id': userId,
          },
        },
      );

      return data;
    } catch (error) {
      if (
        error.status === 451 &&
        get(error, 'response.data.verificationLink')
      ) {
        return {
          status: 451,
          data: {
            verificationLink: get(error, 'response.data.verificationLink'),
          },
        };
      }

      throw this.mapCoinflowError(
        error,
        'Failed to register user as withdrawer',
      );
    }
  }
}
