import { Injectable, BadRequestException, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletsService } from '../wallets/wallets.service';
import { CurrencyType, TransactionType } from '../wallets/entities/transaction.entity';
import { CoinPackageService } from '../coin-package/coin-package.service';
import { BettingGateway } from '../betting/betting.gateway';
import Stripe from 'stripe';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { NotificationService } from 'src/notification/notification.service';

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
    private coinPackageService: CoinPackageService,
    private bettingGateway: BettingGateway,
    private notificationService:NotificationService
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

    // Create Stripe Checkout Session
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: selectedPackage.name,
              description: `${selectedPackage.sweepCoins} Sweep Coins`,
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
        sweepCoins: selectedPackage.sweepCoins.toString(),
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

      // Add sweep coins to user's wallet
      if (session.metadata?.userId && session.metadata?.sweepCoins) {
        const userId = session.metadata.userId;
        const sweepCoins = parseInt(session.metadata.sweepCoins, 10);
        const packageName = session.metadata.packageId;

        await this.walletsService.addSweepCoins(
          userId,
          sweepCoins,
          `Purchase of ${packageName} sweep coin package`,
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
          `Auto-reload purchase of ${sweepCoins} sweep coins`,
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

  /** Maps an Axios error from Coinflow into a meaningful HttpException. */
  private mapCoinflowError(error: unknown, prefix: string): HttpException {
    const axiosError = error as AxiosError<any>;
    const status = axiosError.response?.status;
    const responseData = axiosError.response?.data;
    const safeDetail =
      (responseData && typeof (responseData as any).message === 'string'
        ? (responseData as any).message
        : typeof responseData === 'string'
        ? responseData
        : axiosError.message) || 'Unknown Coinflow error';

    const message = status
      ? `${prefix}: [${status}] ${safeDetail}`
      : `${prefix}: ${safeDetail}`;

    const httpStatus =
      typeof status === 'number' && status >= 400 && status < 600
        ? status
        : HttpStatus.BAD_GATEWAY;
    return new HttpException(message, httpStatus);
  }

  /**
   * Handle Coinflow webhook events. On 'settled', credit coins and record purchase transactions.
   * Expected payload contains data.webhookInfo with at least userId and coinPackageId.
   */
  async handleCoinflowWebhookEvent(payload: any) {
    try {
      const eventType: string = payload?.eventType || payload?.event || '';
      if (!eventType) {
        throw new BadRequestException('Missing event type');
      }

      if (eventType.toLowerCase() !== 'settled') {
        return { ignored: true };
      }

      const rawCustomerId: string | undefined = payload?.data?.rawCustomerId;
      const rawWebhookInfo = payload?.data?.webhookInfo as unknown;
      let parsedInfo: Record<string, unknown> = {};
      // If the entire webhookInfo is a JSON string, parse it
      if (typeof rawWebhookInfo === 'string') {
        const trimmed = rawWebhookInfo.trim();
        if (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
          try {
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj === 'object') parsedInfo = obj as Record<string, unknown>;
          } catch {
            // leave parsedInfo empty
          }
        }
      } else if (rawWebhookInfo && typeof rawWebhookInfo === 'object') {
        parsedInfo = { ...(rawWebhookInfo as Record<string, unknown>) };
        // Some providers send nested stringified JSON values; parse them defensively
        for (const [k, v] of Object.entries(rawWebhookInfo as Record<string, unknown>)) {
          if (typeof v === 'string') {
            const s = v.trim();
            if (
              (s.startsWith('{') && s.endsWith('}')) ||
              (s.startsWith('[') && s.endsWith(']'))
            ) {
              try {
                parsedInfo[k] = JSON.parse(s);
              } catch {
                // keep original string if JSON.parse fails
              }
            }
          }
        }
      }

      // Attempt to read coin package id from known keys or nested objects
      const tryGetFrom = (obj: any, key: string): string | undefined => {
        if (!obj || typeof obj !== 'object') return undefined;
        if (typeof obj[key] === 'string') return obj[key];
        for (const val of Object.values(obj)) {
          if (val && typeof val === 'object') {
            const found = tryGetFrom(val, key);
            if (found) return found;
          }
        }
        return undefined;
      };

      const userId: string | undefined = rawCustomerId;
      const coinPackageId: string | undefined =
        (parsedInfo['coin_package_id'] as string | undefined) ||
        (parsedInfo['coinPackageId'] as string | undefined) ||
        tryGetFrom(parsedInfo, 'coin_package_id') ||
        tryGetFrom(parsedInfo, 'coinPackageId') ||
        (payload?.data?.coinPackageId as string | undefined);

      const webhookEnv: string | undefined =
        (parsedInfo['env'] as string | undefined) ||
        (parsedInfo['env'] as string | undefined) ||
        tryGetFrom(parsedInfo, 'env') ||
        tryGetFrom(parsedInfo, 'env') ||
        (payload?.data?.env as string | undefined);

      if (!userId) {
        throw new BadRequestException('Missing userId (rawCustomerId)');
      }
      if (!coinPackageId) {
        throw new BadRequestException('Missing coinPackageId (webhookInfo.coin_package_id)');
      }

       const expected = (
         this.configService.get<string>('coinflow.webhookEnv') || 'dev'
       )
         .trim()
         .toLowerCase();
       const received = webhookEnv?.trim().toLowerCase();
       if (!received || received !== expected) {
         Logger.log(
           `Ignored Coinflow webhook due to env mismatch (received="${received ?? 'undefined'}", expected="${expected}")`,
           PaymentsService.name,
         );
         return { ignored: true };
       }

      const coinPackage = await this.coinPackageService.findById(coinPackageId);
      if (!coinPackage) {
        throw new NotFoundException('Coin package not found');
      }

      const relatedEntityId = payload?.data?.id as string | undefined;
      const relatedEntityType = 'coinflow';

      // If we've already processed this purchase for a given currency, skip credit for that currency
      // Gold coins
      if (Number(coinPackage.goldCoinCount) > 0) {
        const exists = relatedEntityId
          ? await this.walletsService.hasTransactionForRelatedEntity(
              relatedEntityId,
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
            { coinPackageId: coinPackage.id, source: 'coinflow' },
            { relatedEntityId, relatedEntityType },
          );
        }
      }

       // Sweep coins
      if (Number(coinPackage.sweepCoinCount) > 0) {
        const exists = relatedEntityId
          ? await this.walletsService.hasTransactionForRelatedEntity(
              relatedEntityId,
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
            `Purchase of ${coinPackage.name}: ${coinPackage.sweepCoinCount} bonus sweep coins`,
            { coinPackageId: coinPackage.id, source: 'coinflow' },
            { relatedEntityId, relatedEntityType },
          );
        }
      }

      Logger.log(`Coinflow settled credited for user ${userId} and package ${coinPackageId}`);

      // Emit socket notification to all of the user's active connections
      const updatedWallet = await this.walletsService.findByUserId(userId);
      this.bettingGateway.emitPurchaseSettled(userId, {
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
      this.notificationService.sendSMTPForCoinPurchaseSuccess(
        userId,
        Number(coinPackage.goldCoinCount) || 0,
        Number(coinPackage.sweepCoinCount) || 0,
      );
      return { processed: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error)?.message || 'Failed to process Coinflow webhook');
    }
  }
}
