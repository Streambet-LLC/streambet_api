import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EbayListingDto, EbaySearchResponseDto } from './dto/ebay-search.dto';

@Injectable()
export class EbayService {
  private readonly logger = new Logger(EbayService.name);

  constructor(private readonly configService: ConfigService) {}

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
    } catch (error) {
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
    } catch (error) {
      this.logger.error('eBay Browse API image search failed', error);
      throw new InternalServerErrorException('eBay image search failed');
    }
  }
}
