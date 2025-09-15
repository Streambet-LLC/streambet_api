import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { PaymentsService } from 'src/payments/payments.service';
import * as _ from 'lodash-es';

const personaIdClassCoinflowIdTypeMapping = {
  dl: 'DRIVERS',
  pp: 'PASSPORT',
  ppc: 'PASSPORT',
  rp: 'RESIDENCE_PERMIT',
  id: 'ID_CARD',
};
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
   * @returns Returns status: "success" = verification was successful | "retry" = needs to repeat the Persona verification on the client side | "failed" = verification failed
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

      // Get reference-id as this was set as the user id on the frontend
      const referencedUserId = _.get(data, ['data', 'attributes', 'reference-id']);
      // const referencedUserId = data.data.attributes['reference-id'];

      if (!referencedUserId) {
        Logger.error("Missing reference ID from persona");
        throw new InternalServerErrorException('Failed to register kyc');
      }

      if (referencedUserId !== userId) {
        throw new BadRequestException('Invalid inquiry ID');
      }

      if (!data.included || !_.isArray(data.included)) {
        Logger.error("Missing included array from persona");
        throw new InternalServerErrorException('Failed to register kyc');
      }

      // Get front photo url
      const documentGovernmentId = data.included.find(
        (item) => item.type === 'document/government-id',
      );

      if (!documentGovernmentId) {
        Logger.error("Missing document/government-id from persona");
        throw new InternalServerErrorException('Failed to register kyc');
      }

      const frontPhotoUrl = _.get(documentGovernmentId, ['attributes', 'front-photo', 'url']);
      const frontPhotoFileName = _.get(documentGovernmentId, ['attributes', 'front-photo', 'filename']);
      
      if (!frontPhotoUrl || !frontPhotoFileName) {
        Logger.error("Missing front-photo from persona");
        throw new InternalServerErrorException('Failed to register kyc');
      }

      const backPhotoUrl = _.get(documentGovernmentId, ['attributes', 'back-photo', 'url']);
      const backPhotoFileName = _.get(documentGovernmentId, ['attributes', 'back-photo', 'filename']);

      const idClass = _.get(documentGovernmentId, ['attributes', 'id-class']);
      const idType = personaIdClassCoinflowIdTypeMapping[idClass] || 'ID_CARD';

      const countryCode = _.get(data, ['data', 'attributes', 'fields', 'address-country-code', 'value']);

      if (!countryCode) {
        Logger.error("Missing country code from persona");
        throw new InternalServerErrorException('Failed to register kyc');
      }

      const frontPhotoRes = await axios.get(frontPhotoUrl, {
        responseType: 'arraybuffer',
      });

      let backPhotoRes: AxiosResponse<any, any>;

      if (backPhotoUrl || backPhotoFileName) { 
        backPhotoRes = await axios.get(backPhotoUrl, {
          responseType: 'arraybuffer',
        });
      }

      const formData = new FormData();
      formData.append('email', userEmail);
      formData.append('country', countryCode);
      formData.append('idType', idType);
      formData.append('idFront', new Blob([frontPhotoRes.data]), frontPhotoFileName);
      
      if (backPhotoUrl || backPhotoFileName) {
        formData.append('idBack', new Blob([backPhotoRes.data]), backPhotoFileName);
      }

      formData.append('merchantId', this.coinflowMerchantId);

      const kycDocResult = await this.paymentsService.registerUserViaDocument(
        userId,
        formData,
      );

      return kycDocResult;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      Logger.error(error);
      throw new InternalServerErrorException('Failed to register kyc');
    }
  }
}
