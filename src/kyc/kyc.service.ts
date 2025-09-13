import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { PaymentsService } from 'src/payments/payments.service';

@Injectable()
export class KycService {
  /** Coinflow API configuration values */
  private readonly personaApiURL: string;
  private readonly personaApiKey: string;
  private readonly personaTimeoutMs: number;
  private readonly personaClient: AxiosInstance;
  private readonly personaMaxRetries: number;
  private readonly personaRetryDelayMs: number;
  private readonly coinflowMerchantId: string;

  constructor(
    private paymentsService: PaymentsService,
    private configService: ConfigService,
  ) {
    this.personaApiURL = this.configService.get<string>('persona.apiUrl') || '';
    this.personaApiKey = this.configService.get<string>('persona.apiKey') || '';
    this.personaTimeoutMs =
      this.configService.get<number>('persona.timeoutMs') || 10000;
    this.personaMaxRetries =
      this.configService.get<number>('persona.maxRetries') || 2;
    this.personaRetryDelayMs =
      this.configService.get<number>('persona.retryDelayMs') || 300;
    this.coinflowMerchantId =
      this.configService.get<string>('coinflow.merchantId') || '';

    this.personaClient = axios.create({
      baseURL: this.personaApiURL.replace(/\/+$/, ''),
      timeout: this.personaTimeoutMs,
      headers: {
        Authorization: `Bearer ${this.personaApiKey}`,
        'Key-Inflection': 'Kebab',
        accept: 'application/json',
      },
    });

    // Response interceptor: simple retry on transient errors (5xx, ECONNRESET, ETIMEDOUT)
    this.personaClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config: any = error.config || {};
        config.__retryCount = config.__retryCount || 0;

        const status = error.response?.status;
        const isRetryableStatus = status && status >= 500 && status < 600;
        const isNetworkError = !status;

        if (
          config.__retryCount < this.personaMaxRetries &&
          (isRetryableStatus || isNetworkError)
        ) {
          config.__retryCount += 1;
          await new Promise((res) => setTimeout(res, this.personaRetryDelayMs));
          return this.personaClient.request(config);
        }
        return Promise.reject(error);
      },
    );
  }

  /**
   * Retrieves verified Persona inquiry and registering the the authenticated user in Coinflow.
   *
   * Flow:
   * - Retrieves the KYC inquiry from Persona.
   * - Downloads the attached images from the inquiry.
   * - Registers the user via Coinflow register endpoint using the fields and images from the retrieved Persona inquiry.
   *
   * @param userId - The application user ID.
   * @param inquiryId - The application user ID.
   * @returns Returns status: "success" = verification was successful | "retry" = needs to repeat the Persona verification on the client side
   */
  async registerKyc(userId: string, userEmail: string, inquiryId: string) {
    if (!this.personaApiURL || !this.personaApiKey) {
      throw new BadRequestException(
        'Persona configuration missing. Please set PERSONA_API_URL and PERSONA_API_KEY',
      );
    }

    if (!inquiryId) throw new BadRequestException('Invalid inquiry ID');

    try {
      // Fetch the inquiry from persona
      const { data } = await this.personaClient.get(`/inquiries/${inquiryId}`);

      console.log('%j', data.data.attributes);
      console.log('%j', data.included);

      // Get reference-id as this was set as the user id on the frontend
      const referencedUserId = data.data.attributes['reference-id'];

      if (referencedUserId !== userId) {
        throw new BadRequestException('Invalid inquiry ID');
      }

      // Get front photo url
      const documentGovernmentId = data.included.find(
        (item) => item.type === 'document/government-id',
      );
      const frontPhotoUrl = documentGovernmentId.attributes['front-photo']
        .url as string;
      const frontPhotoFileName = documentGovernmentId.attributes['front-photo']
        .filename as string;
      const countryCode = data.data.attributes.fields['address-country-code']
        .value as string;

      console.log(
        documentGovernmentId,
        frontPhotoUrl,
        frontPhotoFileName,
        countryCode,
      );

      const response = await axios.get(frontPhotoUrl, {
        responseType: 'arraybuffer',
      });

      console.log(response);

      const formData = new FormData();
      formData.append('email', userEmail);
      formData.append('country', countryCode);
      formData.append('idType', 'ID_CARD');
      formData.append('idFront', new Blob([response.data]), frontPhotoFileName);
      formData.append('idBack', new Blob([response.data]), frontPhotoFileName);
      formData.append('merchantId', this.coinflowMerchantId);

      const kycDocResult = await this.paymentsService.registerUserViaDocument(
        userId,
        formData,
      );

      console.log(kycDocResult);

      return kycDocResult;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      Logger.error(error);
      throw new InternalServerErrorException('Failed to register kyc');
    }

    // const coins = Number(params?.coins);
    // if (!Number.isInteger(coins) || coins <= 0) {
    //   throw new BadRequestException('Invalid coins value');
    // }
    // if (
    //   !params?.account ||
    //   typeof params.account !== 'string' ||
    //   !params.account.trim()
    // ) {
    //   throw new BadRequestException('Missing or invalid payout account token');
    // }
    // if (!params?.speed) {
    //   throw new BadRequestException('Missing payout speed');
    // }

    // try {
    //   // Convert coins to USD and validate balance and minimum thresholds
    //   const { dollars } = await this.walletsService.convertSweepCoinsToDollars(
    //     userId,
    //     coins,
    //   );

    //   const idempotencyKey = randomUUID();

    //   // Call Coinflow delegated payout endpoint (amount in cents)
    //   const cents = Math.round(Number(dollars) * 100);
    //   const { data } = await this.coinflowClient.post(
    //     '/api/merchant/withdraws/payout/delegated',
    //     {
    //       amount: { cents },
    //       speed: params.speed,
    //       account: params.account,
    //       userId,
    //       idempotencyKey,
    //     },
    //   );

    //   return {
    //     amountOutUSD: dollars,
    //     amountOutCents: cents,
    //     coins,
    //     speed: params.speed,
    //     account: params.account,
    //     idempotencyKey,
    //     coinflow: data,
    //   };
    // } catch (error) {
    //   if (error instanceof HttpException) {
    //     throw error;
    //   }
    //   throw this.mapCoinflowError(error, 'Failed to initiate withdraw');
    // }
  }
}
