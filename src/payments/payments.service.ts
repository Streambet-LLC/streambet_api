import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletsService } from '../wallets/wallets.service';
import Stripe from 'stripe';
import axios, { AxiosError, AxiosInstance } from 'axios';

@Injectable()
export class PaymentsService {
  private stripe: Stripe;
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
          await new Promise((res) => setTimeout(res, this.coinflowRetryDelayMs));
          return this.coinflowClient.request(config);
        }
        return Promise.reject(error);
      },
    );
  }

  async createCheckoutSession(userId: string, packageId: string) {
    // Define available packages
    type PackageInfo = {
      id: string;
      name: string;
      coins: number;
      price: number;
    };

    const packages: Record<string, PackageInfo> = {
      small: { id: 'small', name: 'Small Pack', coins: 500, price: 5 },
      medium: { id: 'medium', name: 'Medium Pack', coins: 1200, price: 10 },
      large: { id: 'large', name: 'Large Pack', coins: 2500, price: 20 },
      premium: { id: 'premium', name: 'Premium Pack', coins: 6500, price: 50 },
    };

    // Check if package exists
    if (!packages[packageId]) {
      throw new BadRequestException('Invalid package selection');
    }

    const selectedPackage = packages[packageId];

    // Create Stripe Checkout Session
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: selectedPackage.name,
              description: `${selectedPackage.coins} Stream Coins`,
            },
            unit_amount: selectedPackage.price * 100, // in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.configService.get<string>('CLIENT_URL', 'http://localhost:3000')}/payment/cancel`,
      metadata: {
        userId,
        packageId,
        coins: selectedPackage.coins.toString(),
      },
    });

    return { sessionId: session.id, url: session.url };
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

    // Handle specific event types
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // Add coins to user's wallet
      if (session.metadata?.userId && session.metadata?.coins) {
        const userId = session.metadata.userId;
        const coins = parseInt(session.metadata.coins, 10);
        const packageName = session.metadata.packageId;

        await this.walletsService.addStreamCoins(
          userId,
          coins,
          `Purchase of ${packageName} coin package`,
          'purchase',
        );
      }
    }

    return { received: true };
  }

  async createAutoReloadSession(userId: string, amount: number) {
    // Check if amount is valid
    if (![5, 10, 15, 20].includes(amount)) {
      throw new BadRequestException('Invalid auto-reload amount');
    }

    // Get stream coins based on amount
    const coinsMap: Record<number, number> = {
      5: 500,
      10: 1200,
      15: 1800,
      20: 2500,
    };

    const coins = coinsMap[amount];

    try {
      // Create payment intent
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: amount * 100, // in cents
        currency: 'usd',
        payment_method_types: ['card'],
        metadata: {
          userId,
          coins: coins.toString(),
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
        paymentIntent.metadata?.coins &&
        paymentIntent.metadata?.autoReload === 'true'
      ) {
        const userId = paymentIntent.metadata.userId;
        const coins = parseInt(paymentIntent.metadata.coins, 10);

        // Add coins to user's wallet
        await this.walletsService.addStreamCoins(
          userId,
          coins,
          `Auto-reload purchase of ${coins} stream coins`,
          'purchase',
        );

        return { success: true, coins };
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
      throw this.mapCoinflowError(error, 'Failed to fetch Coinflow session key');
    }
  }

  /**
   * Retrieves the Coinflow withdraw payload for the given user.
   *
   * @param userId - The application user ID.
   * @returns The withdraw payload returned by Coinflow.
   * @throws BadRequestException If configuration is missing or the upstream request fails.
   */
  async getCoinflowWithdraw(userId: string) {
    if (!this.coinflowApiUrl || !this.coinflowApiKey) {
      throw new BadRequestException(
        'Coinflow configuration missing. Please set COINFLOW_API_URL and COINFLOW_API_KEY',
      );
    }

    try {
      const { data } = await this.coinflowClient.get('/api/withdraw', {
        headers: {
          'x-coinflow-auth-user-id': userId,
        },
      });

      return data;
    } catch (error) {
      throw this.mapCoinflowError(error, 'Failed to fetch Coinflow withdraw data');
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
      throw this.mapCoinflowError(error, 'Failed to fetch Coinflow withdraw quote');
    }
  }

  /** Maps an Axios error from Coinflow into a meaningful BadRequestException. */
  private mapCoinflowError(error: unknown, prefix: string): BadRequestException {
    const axiosError = error as AxiosError<any>;
    const status = axiosError.response?.status;
    const responseData = axiosError.response?.data;
    const details =
      typeof responseData === 'object' && responseData
        ? JSON.stringify(responseData)
        : axiosError.message || 'Unknown Coinflow error';

    const message = status
      ? `${prefix}: [${status}] ${details}`
      : `${prefix}: ${details}`;

    return new BadRequestException(message);
  }
}
