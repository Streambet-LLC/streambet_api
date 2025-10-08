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
import { CoinflowWithdrawKycDto, CoinflowWithdrawKycUsDto } from './dto/coinflow-withdraw.dto';
import { get } from 'lodash-es';
import { CoinflowWebhookDto } from './dto/coinflow-webhook.dto';
import { WebhookDto } from 'src/webhook/dto/webhook.dto';
import { Repository } from 'typeorm';
import { Transaction } from 'src/wallets/entities/transaction.entity';
import { InjectRepository } from '@nestjs/typeorm';

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
    private walletGateway: WalletGateway,
    @Inject(forwardRef(() => NotificationService)) private readonly notificationService: NotificationService,
    @InjectRepository(Transaction) private transactionsRepository: Repository<Transaction>,
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
          redirectLink
        },
        headers: {
          'x-coinflow-auth-user-id': userId,
        },
      });

      return data;
    } catch (error) {
      if (error.status === 451 && get(error, "response.data.verificationLink")) {
        return {
          status: 451,
          data: { verificationLink: get(error, "response.data.verificationLink") },
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
            if (Array.isArray((current as any).bankAccounts)) {
              return (current as any).bankAccounts as any[];
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
          (acc as any).token,
          (acc as any).accountToken,
          (acc as any).bankAccountToken,
          (acc as any).id,
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
      (responseData && typeof (responseData as any).message === 'string'
        ? (responseData as any).message
        : typeof responseData === 'string'
          ? responseData
          : axiosError.message) || 'Unknown Coinflow error';

    // If details exist, append them
    const details =
      responseData && (responseData as any).details
        ? `, ${(responseData as any).details}`
        : '';

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

      if (category === "Purchase") {
        this.handleCoinflowWebhookPurchase(webhook.webhookId, payload);
      } else if (category === "Withdraw") {
        this.handleCoinflowWebhookWithdraw(webhook.webhookId, payload);
      }
    } catch (error) {
      if (error instanceof HttpException) {
        Logger.error(`Failed to process Coinflow webhook ${webhook.webhookId}: ${error}`, PaymentsService.name);
        return;
      }

      Logger.error(`Failed to process Coinflow webhook ${webhook.webhookId}: ${(error as Error)?.message}`, PaymentsService.name);
      return;
    }
  }

  /**
   * Handle Coinflow purchase webhook events
   */
  async handleCoinflowWebhookPurchase(webhookId: string, payload: CoinflowWebhookDto) {
    try {
      const { eventType, category, data } = payload;

      if (category !== "Purchase") return;

      if (eventType === "Settled") {
        const userId = data.rawCustomerId as string | undefined;
        const coinPackageId = get(data, "webhookInfo.coin_package_id") as string | undefined;
        const webhookEnv = get(data, "webhookInfo.env") as string | undefined;
        const relatedEntityId = data.id as string | undefined;

        if (!userId) {
          throw new BadRequestException('Missing userId (rawCustomerId)');
        }

        if (!coinPackageId) {
          throw new BadRequestException('Missing coinPackageId (webhookInfo.coin_package_id)');
        }

        if (!relatedEntityId) {
          throw new BadRequestException('Missing dataId (data.id)');
        }

        const expectedEnv = (this.configService.get<string>('coinflow.webhookEnv') || 'dev').trim().toLowerCase();
        const receivedEnv = webhookEnv.trim().toLowerCase();

        if (expectedEnv !== receivedEnv) {
          throw new BadRequestException(`mismatch (received="${receivedEnv ?? 'undefined'}", expected="${expectedEnv}"'`);
        }

        const coinPackage = await this.coinPackageService.findById(coinPackageId);

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
              { coinPackageId: coinPackage.id, source: 'coinflow', usdAmount: Number(coinPackage.totalAmount) },
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
              `Purchase of ${coinPackage.name}: ${coinPackage.sweepCoinCount} bonus sweep coins`,
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
        Logger.error(`Failed to process Coinflow purchase webhook ${webhookId}: ${error}`, PaymentsService.name);
        return;
      }

      Logger.error(`Failed to process Coinflow purchase webhook ${webhookId}: ${(error as Error)?.message}`, PaymentsService.name);
      return;
    }
  }

  /**
   * Handle Coinflow withdraw webhook events
   */
  async handleCoinflowWebhookWithdraw(webhookId: string, payload: CoinflowWebhookDto) {
    try {
      const { eventType, category, data } = payload;

      if (category !== "Withdraw" || (eventType !== "Withdraw Success" && eventType !== "Withdraw Failure")) return;

      const relatedEntityId = data.signature as string | undefined;
      const relatedEntityType = 'coinflow';

      if (!relatedEntityId) {
        throw new BadRequestException('Missing signature (data.signature)');
      }

      const clauses = [
        TransactionType.WITHDRAWAL_PENDING,
        TransactionType.WITHDRAWAL_SUCCESS,
        TransactionType.WITHDRAWAL_FAILED
      ].map((type) => ({ 
        relatedEntityId,
        type,
        relatedEntityType,
        currencyType: CurrencyType.SWEEP_COINS,
      }));

      const withdrawals = await this.transactionsRepository.find({
        where: clauses,
      });

      const initialTransaction = withdrawals.find((withdrawal) => withdrawal.type === TransactionType.WITHDRAWAL_PENDING);

      if (!initialTransaction) {
        Logger.warn(`Ignoring coinflow webhook ${webhookId}: provided signature does not match any initial transaction`);
        return;
      }

      if (withdrawals.filter((withdrawal) => 
        withdrawal.type === TransactionType.WITHDRAWAL_SUCCESS || 
        withdrawal.type === TransactionType.WITHDRAWAL_FAILED).length > 0
      ) {
        Logger.warn(`Ignoring coinflow webhook ${webhookId}: provided signature has already been completed`);
        return;
      }

      await this.walletsService.updateBalance(
        initialTransaction.userId,
        eventType === "Withdraw Success" ? 0 : initialTransaction.metadata.sweepCoins,
        CurrencyType.SWEEP_COINS,
        eventType === "Withdraw Success" ? TransactionType.WITHDRAWAL_SUCCESS : TransactionType.WITHDRAWAL_FAILED,
        `Withdrawal of ${initialTransaction.metadata.sweepCoins} Sweep Coins to $${initialTransaction.metadata.usdAmount} ${
          eventType === "Withdraw Success" ? "was successful" : "failed"
        }`,
        initialTransaction.metadata,
        { relatedEntityId, relatedEntityType },
      );

      // Emit socket notification to all of the user's active connections
      if (eventType === "Withdraw Success") {
        this.walletGateway.emitWithdrawSuccess(initialTransaction.userId, {
          message: `Withdraw Success: ${initialTransaction.metadata.sweepCoins} Sweep Coins`,
          sweepCoins: initialTransaction.metadata.sweepCoins,
        });
      } else if (eventType === "Withdraw Failure") {
        this.walletGateway.emitWithdrawFailed(initialTransaction.userId, {
          message: `Withdraw Failed: ${initialTransaction.metadata.sweepCoins} Sweep Coins`,
          sweepCoins: initialTransaction.metadata.sweepCoins,
        });
      }
      
      Logger.log(
        `Coinflow ${eventType} for user ${initialTransaction.userId} with ${initialTransaction.metadata.sweepCoins} Sweep Coins to $${initialTransaction.metadata.usdAmount}`,
      );

      // Send email notification to the user
      // await this.notificationService.sendSMTPForCoinPurchaseSuccess(
      //   userId,
      //   Number(coinPackage.goldCoinCount) || 0,
      //   Number(coinPackage.sweepCoinCount) || 0,
      // );
    } catch (error) {
      if (error instanceof HttpException) {
        Logger.error(`Failed to process Coinflow withdraw webhook ${webhookId}: ${error}`, PaymentsService.name);
        return;
      }

      Logger.error(`Failed to process Coinflow withdraw webhook ${webhookId}: ${(error as Error)?.message}`, PaymentsService.name);
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
        `Withdrawal of ${params.coins} Sweep Coins to $${dollars} initiated`,
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
      if (error.status === 451 && get(error, "response.data.verificationLink")) {
        return {
          status: 451,
          data: { verificationLink: get(error, "response.data.verificationLink") },
        };
      }
      throw this.mapCoinflowError(error, 'Failed to initiate withdraw');
    }
  }

  async registerUserKyc(userId: string, params: CoinflowWithdrawKycDto) {
    if (!this.coinflowApiUrl || !this.coinflowApiKey || !this.coinflowMerchantId) {
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
      if (error.status === 451 && get(error, "response.data.verificationLink")) {
        return {
          status: 451,
          data: { verificationLink: get(error, "response.data.verificationLink") },
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
          }
        },
        {
          headers: {
            'x-coinflow-auth-user-id': userId,
          },
        },
      );

      return data;
    } catch (error) {
      if (error.status === 451 && get(error, "response.data.verificationLink")) {
        return {
          status: 451,
          data: { verificationLink: get(error, "response.data.verificationLink") },
        };
      }
      
      throw this.mapCoinflowError(
        error,
        'Failed to register user as withdrawer',
      );
    }
  }
}
