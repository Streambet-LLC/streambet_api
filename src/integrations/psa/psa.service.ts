import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { PsaImportResponseDto } from './dto/psa-import.dto';
import { EmailsService } from '../../emails/email.service';

type PsaCertificationPayload = {
  PSACert?: Record<string, any> | null;
  DNACert?: Record<string, any> | null;
};

type PsaImagePayloadItem = {
  ImageURL?: string;
  ImageUrl?: string;
  Url?: string;
  url?: string;
  IsFrontImage?: boolean;
  isFrontImage?: boolean;
  Front?: boolean;
  front?: boolean;
};

type PsaPopulationPayload = {
  PSAPop?: Record<string, number | string | null | undefined> | null;
  PSADNAPop?: Record<string, number | string | null | undefined> | null;
};

@Injectable()
export class PsaService {
  private readonly logger = new Logger(PsaService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly emailsService: EmailsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async importCertification(certNumber: string): Promise<PsaImportResponseDto> {
    const normalizedCertNumber = this.normalizeCertNumber(certNumber);
    const cacheKey = `psa:cert:v3:${normalizedCertNumber}`;

    const cached = await this.cacheManager.get<PsaImportResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const accessToken = this.configService.get<string>('psa.accessToken', '');
    const baseUrl = this.configService.get<string>(
      'psa.apiBaseUrl',
      'https://api.psacard.com/publicapi',
    );
    const timeoutMs = this.configService.get<number>('psa.timeoutMs', 10000);
    const cacheTtlSeconds = this.configService.get<number>(
      'psa.cacheTtlSeconds',
      86400,
    );

    if (!accessToken) {
      throw new ServiceUnavailableException(
        'PSA access token is not configured',
      );
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    let certification: PsaCertificationPayload;
    let rateLimitedUntilTomorrow = false;
    let rateLimitedUntil: string | null = null;

    try {
      const response = await axios.get<PsaCertificationPayload>(
        `${baseUrl}/cert/GetByCertNumber/${encodeURIComponent(normalizedCertNumber)}`,
        {
          headers,
          timeout: timeoutMs,
        },
      );
      certification = response.data;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        rateLimitedUntilTomorrow = true;
        rateLimitedUntil = this.getTomorrowStartIso();
        await this.notifyPsaRateLimited(
          normalizedCertNumber,
          'certification lookup',
          error,
        );
      }
      throw this.mapAxiosError(error, 'certification lookup');
    }

    const psaCert = certification?.PSACert || certification?.DNACert;
    if (!psaCert) {
      throw new NotFoundException(
        `PSA certification ${normalizedCertNumber} was not found`,
      );
    }

    let imageUrls: string[] = [];
    try {
      const imageResponse = await axios.get(
        `${baseUrl}/cert/GetImagesByCertNumber/${encodeURIComponent(normalizedCertNumber)}`,
        {
          headers,
          timeout: timeoutMs,
        },
      );
      imageUrls = this.normalizeImageUrls(imageResponse.data);
    } catch (error) {
      if (this.isRateLimitError(error)) {
        rateLimitedUntilTomorrow = true;
        rateLimitedUntil = this.getTomorrowStartIso();
        await this.notifyPsaRateLimited(
          normalizedCertNumber,
          'image lookup',
          error,
        );
      }

      this.logger.warn(
        `PSA image lookup failed for cert ${normalizedCertNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const specId = this.toNullableNumber(psaCert.SpecID);
    let psaPopulation: {
      gradePopulation: number | null;
    } | null = null;

    if (specId !== null) {
      try {
        const populationResponse = await axios.get<PsaPopulationPayload>(
          `${baseUrl}/pop/GetPSASpecPopulation/${specId}`,
          {
            headers,
            timeout: timeoutMs,
          },
        );

        const psaPopSummary = populationResponse.data?.PSAPop ?? null;

        const populationGradeKey = this.resolvePopulationGradeKey(
          psaCert.CardGrade,
        );
        const gradePopulation = this.toNullableNumber(
          populationGradeKey ? psaPopSummary?.[populationGradeKey] : null,
        );

        psaPopulation = {
          gradePopulation,
        };
      } catch (error) {
        if (this.isRateLimitError(error)) {
          rateLimitedUntilTomorrow = true;
          rateLimitedUntil = this.getTomorrowStartIso();
          await this.notifyPsaRateLimited(
            normalizedCertNumber,
            'population lookup',
            error,
          );
        }

        this.logger.warn(
          `PSA population lookup failed for cert ${normalizedCertNumber} (specId ${specId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const response: PsaImportResponseDto = this.buildImportResponse(
      normalizedCertNumber,
      psaCert,
      imageUrls,
      specId,
      psaPopulation,
      rateLimitedUntilTomorrow,
      rateLimitedUntil,
    );

    await this.cacheManager.set(cacheKey, response, cacheTtlSeconds);

    return response;
  }

  private normalizeCertNumber(certNumber: string): string {
    const normalized = certNumber.trim();
    if (!normalized) {
      throw new BadRequestException('certNumber is required');
    }
    return normalized;
  }

  private normalizeImageUrls(data: unknown): string[] {
    const rawItems = Array.isArray(data)
      ? data
      : Array.isArray((data as { Images?: unknown })?.Images)
        ? (data as { Images?: unknown[] }).Images
        : Array.isArray((data as { images?: unknown })?.images)
          ? (data as { images?: unknown[] }).images
          : [];

    const mapped = rawItems
      .map((item) => item as PsaImagePayloadItem)
      .map((item) => ({
        url: item.ImageURL || item.ImageUrl || item.Url || item.url || '',
        isFront:
          item.IsFrontImage ??
          item.isFrontImage ??
          item.Front ??
          item.front ??
          false,
      }))
      .filter((item) => item.url.trim().length > 0)
      .sort((a, b) => Number(b.isFront) - Number(a.isFront))
      .map((item) => item.url.trim());

    return Array.from(new Set(mapped));
  }

  private buildImportResponse(
    certNumber: string,
    psaCert: Record<string, any>,
    imageUrls: string[],
    specId: number | null,
    psaPopulation: {
      gradePopulation: number | null;
    } | null,
    rateLimitedUntilTomorrow: boolean,
    rateLimitedUntil: string | null,
  ): PsaImportResponseDto {
    const year = this.toNullableString(psaCert.Year);
    const brand = this.toNullableString(psaCert.Brand);
    const category = this.toNullableString(psaCert.Category);
    const cardNumber = this.toNullableString(psaCert.CardNumber);
    const subject = this.toNullableString(psaCert.Subject);
    const variety = this.toNullableString(psaCert.Variety);
    const gradeDescription = this.toNullableString(psaCert.GradeDescription);
    const cardGrade = this.toNullableString(psaCert.CardGrade);
    const labelType = this.normalizeLabelType(
      this.toNullableString(psaCert.LabelType),
    );
    const reverseCertBarcode = this.toYesNoString(psaCert.ReverseBarCode);

    const titleParts = [
      cardGrade
        ? `PSA ${cardGrade}`
        : gradeDescription
          ? `PSA ${gradeDescription}`
          : 'PSA Graded',
      year,
      brand,
      subject,
      variety,
      cardNumber ? `#${cardNumber}` : null,
    ].filter((part): part is string => Boolean(part && part.trim().length > 0));

    const title = titleParts.join(' ');
    const coverImageIndex = imageUrls.length > 0 ? 0 : 0;
    const itemInformation = {
      certNumber,
      itemGrade: cardGrade ?? gradeDescription,
      labelType,
      fugitiveInkTechnology: this.resolveFugitiveInkTechnology(labelType),
      reverseCertBarcode,
      year,
      brandTitle: brand,
      subject,
      cardNumber,
      category: category ? category.toUpperCase() : null,
      varietyPedigree: variety,
    };

    return {
      certNumber,
      title,
      brand,
      category,
      year,
      cardNumber,
      subject,
      variety,
      gradeDescription,
      cardGrade,
      description: title || null,
      imageUrls,
      coverImageIndex,
      coverImageUrl: imageUrls[0] || null,
      hasImages: imageUrls.length > 0,
      psaSpecId: specId,
      psaPopulation,
      rateLimitedUntilTomorrow,
      rateLimitedUntil,
      psaCertUrl: `https://www.psacard.com/cert/${encodeURIComponent(certNumber)}/psa`,
      itemInformation,
      source: 'psa',
    };
  }

  private resolvePopulationGradeKey(cardGradeRaw: unknown): string | null {
    const cardGrade = this.toNullableString(cardGradeRaw);
    if (!cardGrade) {
      return null;
    }

    // Extract trailing numeric grade (e.g., "GEM MT 10" -> "10", "MINT 9Q" -> "9Q")
    const match = cardGrade.match(/(\d+(?:\.\d+)?)([Qq])?$/);
    if (!match) {
      return null;
    }

    const numericGrade = match[1];
    const isQualified = Boolean(match[2]);

    let key = `Grade${numericGrade.replace('.', '_')}`;
    if (isQualified) {
      key += 'Q';
    }

    return key;
  }

  private toNullableString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private toYesNoString(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'boolean') {
      return value ? 'YES' : 'NO';
    }

    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (['1', 'true', 'yes', 'y'].includes(normalized)) {
      return 'YES';
    }

    if (['0', 'false', 'no', 'n'].includes(normalized)) {
      return 'NO';
    }

    return String(value).trim().toUpperCase();
  }

  private resolveFugitiveInkTechnology(
    labelType: string | null,
  ): string | null {
    if (!labelType) {
      return null;
    }

    return labelType.toLowerCase().includes('fugitive ink') ? 'YES' : 'NO';
  }

  private normalizeLabelType(labelType: string | null): string | null {
    if (!labelType) {
      return null;
    }

    const normalized = labelType.trim().toLowerCase();
    if (normalized === 'lighthouselabel') {
      return 'PSA Fugitive Ink Technology';
    }

    return labelType;
  }

  private isRateLimitError(error: unknown): error is AxiosError {
    return axios.isAxiosError(error) && error.response?.status === 429;
  }

  private getTomorrowStartIso(): string {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    return tomorrow.toISOString();
  }

  private async notifyPsaRateLimited(
    certNumber: string,
    stage: string,
    error: AxiosError,
  ): Promise<void> {
    try {
      const now = new Date();
      const dayKey = now.toISOString().slice(0, 10);
      const alertKey = `psa:rate-limit-alert:${dayKey}`;
      const alreadyAlerted = await this.cacheManager.get<boolean>(alertKey);
      if (alreadyAlerted) {
        return;
      }

      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      const ttlSeconds = Math.max(
        60,
        Math.floor((tomorrow.getTime() - Date.now()) / 1000),
      );

      const retryAfterHeader =
        error.response?.headers?.['retry-after'] ||
        error.response?.headers?.['Retry-After'];
      const retryAfter = Array.isArray(retryAfterHeader)
        ? retryAfterHeader[0]
        : retryAfterHeader;

      const subject = 'PSA API rate limit alert';
      const html = `
        <p>PSA API returned HTTP 429.</p>
        <p><strong>Time:</strong> ${this.escapeHtml(now.toISOString())}</p>
        <p><strong>Stage:</strong> ${this.escapeHtml(stage)}</p>
        <p><strong>Cert Number:</strong> ${this.escapeHtml(certNumber)}</p>
        <p><strong>Retry-After:</strong> ${this.escapeHtml(retryAfter ? String(retryAfter) : 'not provided')}</p>
        <p><strong>Message:</strong> PSA is rate-limiting requests right now. Try again tomorrow.</p>
      `;

      await this.emailsService.sendEmailFn(
        {
          to: 'info@streambet.tv',
          subject,
        },
        html,
      );

      await this.cacheManager.set(alertKey, true, ttlSeconds);
    } catch (notifyError) {
      this.logger.error(
        `Failed to send PSA rate-limit alert email: ${notifyError instanceof Error ? notifyError.message : String(notifyError)}`,
      );
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private mapAxiosError(error: unknown, label: string): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string }>;
      const status = axiosError.response?.status;

      if (status === 401 || status === 403) {
        return new ServiceUnavailableException(
          `PSA ${label} failed: access token was rejected`,
        );
      }

      if (status === 429) {
        return new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            errorCode: 'PSA_RATE_LIMITED',
            source: 'psa',
            rateLimitedUntilTomorrow: true,
            rateLimitedUntil: this.getTomorrowStartIso(),
            message:
              'PSA is rate-limiting requests right now. Try again tomorrow.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (status === 404) {
        return new NotFoundException(`PSA ${label} not found`);
      }

      return new ServiceUnavailableException(
        `PSA ${label} failed: ${axiosError.message}`,
      );
    }

    return new ServiceUnavailableException(
      `PSA ${label} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
