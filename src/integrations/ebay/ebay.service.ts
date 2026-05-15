import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EbayListingDto, EbaySearchResponseDto } from './dto/ebay-search.dto';
import { normalizeEbaySearchKeywords } from './ebay-query.utils';
import { EbayKeyManagerService } from './ebay-key-manager.service';

type CompletedItemProduct = {
  title?: string;
  sale_price?: number | string | null;
  currency?: string | null;
  condition?: string | null;
  buying_format?: string | null;
  date_sold?: string | null;
  image_url?: string | null;
  shipping_price?: number | string | null;
  link?: string | null;
  item_id?: string | null;
};

type CompletedItemsResponse = {
  success?: boolean;
  average_price?: number;
  median_price?: number;
  min_price?: number;
  max_price?: number;
  results?: number;
  total_results?: number;
  response_url?: string;
  products?: CompletedItemProduct[];
};

export type EbayCompletedItem = {
  title: string | null;
  salePrice: number | null;
  currencySymbol: string | null;
  itemCondition: string | null;
  buyingFormat: string | null;
  dateSold: Date | null;
  imageUrl: string | null;
  shippingPrice: number | null;
  listingUrl: string | null;
  providerItemId: string | null;
  rawPayload: Record<string, unknown>;
};

export type EbayCompletedItemsResult = {
  query: string;
  source: string;
  responseUrl: string | null;
  products: EbayCompletedItem[];
  resultCount: number;
};

@Injectable()
export class EbayService {
  private readonly logger = new Logger(EbayService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly keyManager: EbayKeyManagerService,
  ) {}

  private normalizeListings(items: any[], safeLimit: number): EbayListingDto[] {
    return items
      .map((item) => {
        const titleValue = item?.title ?? null;
        return {
          title: titleValue,
          price: item?.price?.value != null ? Number(item.price.value) : null,
          currency: item?.price?.currency ?? null,
          condition: item?.condition ?? null,
          grade: this.extractGradeFromTitle(titleValue),
          imageUrl:
            item?.thumbnailImages?.[0]?.imageUrl ??
            item?.image?.imageUrl ??
            null,
          itemWebUrl: item?.itemWebUrl ?? null,
          seller: item?.seller?.username ?? null,
          buyingOptions: item?.buyingOptions ?? [],
        };
      })
      .filter((item) => item.price !== null)
      .slice(0, safeLimit);
  }

  private normalizeImageBase64(imageBase64: string): string {
    return imageBase64
      .trim()
      .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  }

  private extractGradeFromTitle(title: string | null): string | null {
    if (!title) return null;

    const patterns = [
      /\b(PSA)\s*(10|9(?:\.5)?|8(?:\.5)?|7(?:\.5)?|6(?:\.5)?|5(?:\.5)?|4(?:\.5)?|3(?:\.5)?|2(?:\.5)?|1)\b/i,
      /\b(BGS|BECKETT)\s*(10|9(?:\.5)?|9|8(?:\.5)?|8|7(?:\.5)?|7|6(?:\.5)?|6|5(?:\.5)?|5)\b/i,
      /\b(SGC)\s*(10|9(?:\.5)?|9|8(?:\.5)?|8|7(?:\.5)?|7|6(?:\.5)?|6|5(?:\.5)?|5)\b/i,
      /\b(CGC)\s*(10|9(?:\.5)?|9|8(?:\.5)?|8|7(?:\.5)?|7|6(?:\.5)?|6|5(?:\.5)?|5)\b/i,
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        const grader =
          match[1].toUpperCase() === 'BECKETT' ? 'BGS' : match[1].toUpperCase();
        return `${grader} ${match[2]}`;
      }
    }

    return null;
  }

  private getRetryAfterSeconds(retryAfterHeader: unknown): number {
    const fallbackSeconds = 3;
    if (typeof retryAfterHeader !== 'string') return fallbackSeconds;

    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(1, Math.floor(seconds));
    }

    const retryAt = Date.parse(retryAfterHeader);
    if (Number.isNaN(retryAt)) return fallbackSeconds;

    const deltaMs = retryAt - Date.now();
    if (deltaMs <= 0) return fallbackSeconds;

    return Math.max(1, Math.ceil(deltaMs / 1000));
  }

  private normalizeCompletedItem(item: CompletedItemProduct): EbayCompletedItem {
    const salePriceRaw =
      typeof item.sale_price === 'number'
        ? item.sale_price
        : Number(item.sale_price ?? NaN);
    const shippingPriceRaw =
      typeof item.shipping_price === 'number'
        ? item.shipping_price
        : Number(item.shipping_price ?? NaN);
    const dateSoldRaw = item.date_sold ? new Date(item.date_sold) : null;

    return {
      title: item.title?.trim() || null,
      salePrice: Number.isFinite(salePriceRaw) ? salePriceRaw : null,
      currencySymbol: item.currency?.trim() || null,
      itemCondition: item.condition?.trim() || null,
      buyingFormat: item.buying_format?.trim() || null,
      dateSold:
        dateSoldRaw && !Number.isNaN(dateSoldRaw.getTime()) ? dateSoldRaw : null,
      imageUrl: item.image_url?.trim() || null,
      shippingPrice: Number.isFinite(shippingPriceRaw) ? shippingPriceRaw : null,
      listingUrl: item.link?.trim() || null,
      providerItemId: item.item_id?.trim() || null,
      rawPayload: item as Record<string, unknown>,
    };
  }

  async findCompletedItems(
    keywords: string,
    maxSearchResults: 60 | 120 | 240 = 240,
  ): Promise<EbayCompletedItemsResult> {
    const trimmedKeywords = normalizeEbaySearchKeywords(keywords);
    if (!trimmedKeywords) {
      throw new HttpException(
        { message: 'keywords must be a non-empty string' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const timeoutMs = this.configService.get<number>('ebay.timeoutMs') ?? 20000;

    const scrapeChainUrl =
      this.configService.get<string>('SCRAPECHAIN_EBAY_COMPLETED_URL') ||
      this.configService.get<string>('EBAY_COMPLETED_DIRECT_URL') || // legacy alias
      'https://ebay-api.scrapechain.com/findCompletedItems';

    const rapidApiHost =
      this.configService.get<string>('RAPIDAPI_EBAY_COMPLETED_HOST') || '';
    const rapidApiUrl =
      this.configService.get<string>('RAPIDAPI_EBAY_COMPLETED_URL') || '';

    const payload = {
      keywords: trimmedKeywords,
      max_search_results: maxSearchResults,
      remove_outliers: true,
      site_id: this.configService.get<string>('EBAY_COMPLETED_SITE_ID') || '0',
      excluded_keywords:
        this.configService.get<string>('EBAY_COMPLETED_EXCLUDED_KEYWORDS') ||
        undefined,
      category_id:
        this.configService.get<string>('EBAY_COMPLETED_CATEGORY_ID') ||
        undefined,
    };

    const hasRapidApiFallback = this.keyManager.hasKeys() && rapidApiHost && rapidApiUrl;

    // Primary: scrapechain
    try {
      const response = await axios.post<CompletedItemsResponse>(scrapeChainUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: timeoutMs,
      });

      const products = Array.isArray(response.data?.products)
        ? response.data.products
        : [];

      return {
        query: trimmedKeywords,
        source: 'scrapechain',
        responseUrl: response.data?.response_url || null,
        products: products.map((item) => this.normalizeCompletedItem(item)),
        resultCount: response.data?.results ?? products.length,
      };
    } catch (scraperError: any) {
      if (!hasRapidApiFallback) {
        if (scraperError?.response?.status === 429) {
          const retryAfterSeconds = this.getRetryAfterSeconds(
            scraperError?.response?.headers?.['retry-after'],
          );
          throw new HttpException(
            {
              message:
                'eBay completed-items rate limit reached. Please retry after the provided delay.',
              retryAfterSeconds,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        this.logger.error('eBay completed-items fetch failed (scrapechain)', scraperError);
        throw new InternalServerErrorException('eBay completed-items fetch failed');
      }

      this.logger.warn(
        `Scrapechain eBay fetch failed (status ${scraperError?.response?.status ?? 'unknown'}), falling back to RapidAPI`,
      );
    }

    // Fallback: RapidAPI with key rotation
    if (!hasRapidApiFallback) {
      this.logger.error('No RapidAPI keys available for fallback');
      throw new InternalServerErrorException('eBay completed-items fetch failed');
    }

    const availableKeys = this.keyManager.getAvailableKeys();
    const maxAttempts = availableKeys.length;
    let lastError: any = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const keyInfo = await this.keyManager.getNextAvailableKey();

      if (!keyInfo) {
        this.logger.warn('All RapidAPI keys are rate-limited');
        break;
      }

      const { key: rapidApiKey, keyIndex } = keyInfo;

      try {
        this.logger.debug(
          `Attempting RapidAPI request with KEY_${keyIndex} (attempt ${attempt + 1}/${maxAttempts})`,
        );

        const response = await axios.post<CompletedItemsResponse>(rapidApiUrl, payload, {
          headers: {
            'Content-Type': 'application/json',
            'x-rapidapi-key': rapidApiKey,
            'x-rapidapi-host': rapidApiHost,
          },
          timeout: timeoutMs,
        });

        const products = Array.isArray(response.data?.products)
          ? response.data.products
          : [];

        this.logger.log(`Successfully fetched eBay data using KEY_${keyIndex}`);

        return {
          query: trimmedKeywords,
          source: `rapidapi-key${keyIndex}`,
          responseUrl: response.data?.response_url || null,
          products: products.map((item) => this.normalizeCompletedItem(item)),
          resultCount: response.data?.results ?? products.length,
        };
      } catch (error: any) {
        lastError = error;

        if (error?.response?.status === 429) {
          // Rate limit hit - mark this key and try next
          const retryAfterSeconds = this.getRetryAfterSeconds(
            error?.response?.headers?.['retry-after'],
          );
          await this.keyManager.markKeyRateLimited(
            keyIndex,
            retryAfterSeconds || 60,
          );

          this.logger.warn(
            `KEY_${keyIndex} rate limited, rotating to next key (${attempt + 1}/${maxAttempts} attempts)`,
          );
          continue; // Try next key
        }

        // Non-429 error - log and try next key
        this.logger.error(
          `KEY_${keyIndex} failed with status ${error?.response?.status ?? 'unknown'}`,
          error,
        );
        continue;
      }
    }

    // All keys exhausted or failed
    if (lastError?.response?.status === 429) {
      const retryAfterSeconds = this.getRetryAfterSeconds(
        lastError?.response?.headers?.['retry-after'],
      );
      throw new HttpException(
        {
          message:
            'All eBay API keys are rate limited. Please retry after the provided delay.',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.logger.error('eBay completed-items fetch failed with all available keys', lastError);
    throw new InternalServerErrorException('eBay completed-items fetch failed');
  }

  private async getAccessToken(): Promise<string> {
    const clientId = this.configService.get<string>('ebay.clientId');
    const clientSecret = this.configService.get<string>('ebay.clientSecret');

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('eBay credentials not configured');
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await axios.post(
      'https://api.ebay.com/identity/v1/oauth2/token',
      'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      },
    );

    return response.data.access_token as string;
  }

  async searchListings(
    title: string,
    limit: number = 5,
  ): Promise<EbaySearchResponseDto> {
    const timeoutMs = this.configService.get<number>('ebay.timeoutMs') ?? 20000;
    const marketplaceId =
      this.configService.get<string>('ebay.marketplaceId') ?? 'EBAY_US';
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const fetchLimit = Math.min(safeLimit * 4, 50);

    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      this.logger.error('Failed to obtain eBay access token', error);
      throw new InternalServerErrorException('Failed to connect to eBay');
    }

    try {
      const response = await axios.get(
        'https://api.ebay.com/buy/browse/v1/item_summary/search',
        {
          params: {
            q: title,
            limit: fetchLimit,
            filter: 'buyingOptions:{FIXED_PRICE}',
          },
          headers: {
            Authorization: `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
            'Content-Type': 'application/json',
          },
          timeout: timeoutMs,
        },
      );

      const items: any[] = response.data?.itemSummaries ?? [];
      const listings = this.normalizeListings(items, safeLimit);

      return { listings };
    } catch (error: any) {
      if (error?.response?.status === 429) {
        const retryAfterSeconds = this.getRetryAfterSeconds(
          error?.response?.headers?.['retry-after'],
        );
        throw new HttpException(
          {
            message: 'eBay rate limit reached. Please retry after the provided delay.',
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      this.logger.error('eBay Browse API search failed', error);
      throw new InternalServerErrorException('eBay search failed');
    }
  }

  async searchListingsByImage(
    imageBase64: string,
    limit: number = 5,
  ): Promise<EbaySearchResponseDto> {
    const timeoutMs = this.configService.get<number>('ebay.timeoutMs') ?? 20000;
    const marketplaceId =
      this.configService.get<string>('ebay.marketplaceId') ?? 'EBAY_US';
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const fetchLimit = Math.min(safeLimit * 4, 50);

    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      this.logger.error('Failed to obtain eBay access token', error);
      throw new InternalServerErrorException('Failed to connect to eBay');
    }

    try {
      const response = await axios.post(
        'https://api.ebay.com/buy/browse/v1/item_summary/search_by_image',
        {
          image: this.normalizeImageBase64(imageBase64),
        },
        {
          params: {
            limit: fetchLimit,
            filter: 'buyingOptions:{FIXED_PRICE}',
          },
          headers: {
            Authorization: `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
            'Content-Type': 'application/json',
          },
          timeout: timeoutMs,
        },
      );

      const items: any[] = response.data?.itemSummaries ?? [];
      const listings = this.normalizeListings(items, safeLimit);

      return { listings };
    } catch (error: any) {
      if (error?.response?.status === 429) {
        const retryAfterSeconds = this.getRetryAfterSeconds(
          error?.response?.headers?.['retry-after'],
        );
        throw new HttpException(
          {
            message: 'eBay rate limit reached. Please retry after the provided delay.',
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      this.logger.error('eBay Browse API image search failed', error);
      throw new InternalServerErrorException('eBay image search failed');
    }
  }
}
