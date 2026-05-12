import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  Min,
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrizeCategory } from '../enums/prize-category.enum';
import { PrizePurchaseOption } from '../enums/prize-purchase-option.enum';
import { PrizeBrand } from '../enums/prize-brand.enum';
import { PrizeSaleType } from '../enums/prize-sale-type.enum';
import { AuctionStatus } from '../enums/auction-status.enum';

/**
 * Lightweight auction summary embedded on PrizeConfigurationDto when
 * `saleType === 'auction'`. Reserve price is intentionally NOT exposed here
 * (only `reserveMet`); admins get the raw value via the admin DTO.
 */
export class AuctionSummaryDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ enum: AuctionStatus })
  status: AuctionStatus;

  @ApiProperty({ example: '2026-04-25T12:00:00Z' })
  startsAt: string;

  @ApiProperty({ example: '2026-04-30T12:00:00Z' })
  endsAt: string;

  @ApiProperty({ example: 1, description: 'Auction length in days (1|3|5|7).' })
  durationDays: number;

  @ApiProperty({ example: 25.0 })
  startingPriceUsd: number;

  @ApiProperty({
    example: 47.0,
    nullable: true,
    description: 'Current high bid (USD).',
  })
  currentBidUsd: number | null;

  @ApiProperty({
    example: 5,
    description: 'Minimum increment for the next bid based on dynamic tiers.',
  })
  minNextBidIncrement: number;

  @ApiProperty({
    example: 50,
    description:
      'Minimum amount required for the next bid (currentBidUsd + increment, or startingPriceUsd).',
  })
  minNextBidUsd: number;

  @ApiProperty({
    example: 7,
    description: 'Total bid actions including auto-bids.',
  })
  bidCount: number;

  @ApiProperty({
    example: 2,
    description:
      'How many times the close was extended by the anti-snipe rule.',
  })
  extensionCount: number;

  @ApiProperty({
    example: false,
    description:
      'True when a reserve exists and the current bid meets it. False when reserve exists and is unmet. Null when no reserve was set.',
    nullable: true,
  })
  reserveMet: boolean | null;

  @ApiProperty({
    example: false,
    description: 'True when the requesting user is the current high bidder.',
  })
  isLeader: boolean;

  @ApiProperty({
    example: false,
    description:
      'True when the requesting user has placed at least one bid on this auction.',
  })
  isBidder: boolean;

  @ApiProperty({
    example: 3,
    description:
      'Buyer processing fee percent applied on top of the winning bid (matches sales fee policy).',
  })
  buyerProcessingFeePercent: number;

  @ApiProperty({
    example: 1.41,
    nullable: true,
    description:
      'Buyer processing fee in USD computed against the current bid (or starting price if no bids). Does not include shipping.',
  })
  buyerProcessingFeeUsd: number | null;

  @ApiProperty({
    example: 48.41,
    nullable: true,
    description:
      'Total amount the winner would be charged at close based on the current bid + buyer processing fee. Excludes shipping (calculated at close).',
  })
  totalDueIfWonUsd: number | null;

  @ApiProperty({
    example: 1.5,
    description:
      'Buyer processing fee in USD computed against the minimum next bid. Helps the bid form show a clean total before submit.',
  })
  minNextBidProcessingFeeUsd: number;

  @ApiProperty({
    example: 51.5,
    description:
      'Total the bidder would be charged if their bid wins at the minimum next bid amount.',
  })
  minNextBidTotalUsd: number;

  @ApiProperty({
    example: 75,
    nullable: true,
    description:
      'The requesting user\u2019s own proxy max on this auction, exposed only when they are the current leader so they can raise it. Null otherwise (proxy maxes are private from competitors).',
  })
  currentUserProxyMaxUsd: number | null;

  @ApiProperty({
    example: 5,
    description:
      'Per-item shipping fee in USD that will be added to the winning bid + buyer processing fee at close.',
  })
  shippingCostUsd: number;
}

/**
 * DTO for individual prize tier information
 */
export class PrizeItemDto {
  @ApiProperty({
    example: 1,
    description: 'Prize tier number (1, 2, 3, etc.)',
  })
  @IsInt()
  @Min(1)
  prizeTier: number;

  @ApiProperty({
    example: 500,
    description: 'Prize amount threshold in lifetime coins',
  })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({
    example: 'Collector',
    description: 'Display name for the prize tier',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Reach 500 lifetime coins to unlock the Collector badge',
    description: 'Description of the prize',
  })
  @IsString()
  description: string;

  @ApiProperty({
    example: 'https://s3.amazonaws.com/...',
    description: 'URL to the prize thumbnail image',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  imageUrl: string | null;
}

export class ItemImageDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({
    example: 'https://s3.amazonaws.com/...',
    description: 'URL to the item image',
  })
  imageUrl: string;

  @ApiProperty({
    example: 0,
    description: 'Display order for the image (0-indexed)',
  })
  displayOrder: number;

  @ApiProperty({
    example: true,
    description: 'Whether this image is currently the cover image',
  })
  isCover: boolean;
}

/**
 * DTO for prize configuration response (single tier)
 */
export class PrizeConfigurationDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({
    example: 1,
    description: 'Prize tier number',
  })
  prizeTier: number;

  @ApiProperty({
    example: 500,
    description: 'Coin threshold for this tier',
  })
  amount: number;

  @ApiProperty({
    example: 'Collector',
    description: 'Tier name',
  })
  name: string;

  @ApiProperty({
    example: 'Reach 500 lifetime coins to unlock the Collector badge',
    description: 'Tier description',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    example: 'https://s3.amazonaws.com/...',
    description: 'Badge image URL',
    nullable: true,
  })
  imageUrl: string | null;

  @ApiProperty({
    example: ['https://s3.amazonaws.com/...', 'https://s3.amazonaws.com/...'],
    description: 'Ordered image URLs for this item (max 7)',
    required: false,
    type: [String],
  })
  imageUrls: string[];

  @ApiProperty({
    description: 'Detailed ordered item images including cover marker',
    type: [ItemImageDto],
    required: false,
  })
  itemImages: ItemImageDto[];

  @ApiProperty({
    example: 'uuid',
    description: 'Cover image ID from item_configuration_images',
    nullable: true,
    required: false,
  })
  coverImageId: string | null;

  @ApiProperty({
    example: 'slab',
    description: 'Prize category: raw, slab, sealed or other',
    enum: ['raw', 'slab', 'sealed', 'other'],
  })
  category: string;

  @ApiProperty({
    example: 'NM',
    description:
      'Grade/condition of the item (e.g. MT, NM, EX for raw; 10, 9, 8 for slabs)',
    nullable: true,
    required: false,
  })
  grade: string | null;

  @ApiProperty({
    example: 100,
    description: 'Stock quantity (0 = unlimited/always in stock)',
    minimum: 0,
  })
  stock: number;

  @ApiProperty({
    example: 'both',
    description: 'Purchase option: offers only, buy only, or both',
    enum: PrizePurchaseOption,
  })
  purchaseOption: PrizePurchaseOption;

  @ApiProperty({
    example: 'pokemon',
    description: 'Prize brand: pokemon, one_piece, or sports',
    enum: PrizeBrand,
  })
  brand: PrizeBrand;

  @ApiProperty({
    example: 1,
    description: 'Display order on shop page (1-indexed, null if not shown)',
    nullable: true,
  })
  displayOrderShop: number | null;

  @ApiProperty({
    example: 1,
    description:
      'Display order on seller-specific shop page (1-indexed, null if not set)',
    nullable: true,
  })
  sellerDisplayOrderShop: number | null;

  @ApiProperty({
    example: 1,
    description:
      'Display order on redemptions page (1-indexed, null if not shown)',
    nullable: true,
  })
  displayOrderRedemptions: number | null;

  @ApiProperty({
    example: 1,
    description: 'Featured carousel display order (null = not featured)',
    nullable: true,
  })
  featuredDisplayOrder: number | null;

  @ApiProperty({
    example: true,
    description: 'Whether to show this prize on the redemptions page',
  })
  showOnRedemptions: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether to show this prize on the shop page',
  })
  showOnShop: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether to sort shop page by purchase option (both first)',
  })
  sortByPurchaseOptionShop: boolean;

  @ApiProperty({
    example: false,
    description:
      'Whether to sort redemptions page by purchase option (both first)',
  })
  sortByPurchaseOptionRedemptions: boolean;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'uuid', nullable: true })
  createdBy: string | null;

  @ApiProperty({
    example: 'aar_cade',
    nullable: true,
    description: 'Username of the seller who created this item',
  })
  createdByUsername: string | null;

  @ApiProperty({
    example: 'My Awesome Shop',
    nullable: true,
    description: 'Shop name set by the seller',
  })
  createdByShopName: string | null;

  @ApiProperty({
    example: false,
    description: 'True if the seller has approved crypto (USDC) payments',
  })
  sellerCryptoEnabled?: boolean;

  @ApiProperty({ example: 'uuid', nullable: true })
  updatedBy: string | null;

  @ApiProperty({
    example: 'charizard psa 10',
    nullable: true,
    description:
      'Optional admin-controlled search phrase for sold-market data. Falls back to item name when null.',
  })
  ebaySearchQuery: string | null;

  @ApiProperty({
    example: '2026-05-01T10:30:00Z',
    nullable: true,
    description:
      'Last datetime when market averages were recalculated for this item.',
  })
  ebayMarketLastCalculatedAt: Date | null;

  @ApiProperty({
    example: false,
    description:
      'Whether eBay sold average data is visible to all users on item cards (not just admins).',
  })
  showEbayAvgPublicly: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether this item is featured on the seller profile page',
  })
  profileFeatured: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether this item is exclusive to CardCade Pro subscribers',
  })
  isProOnly: boolean;

  @ApiProperty({
    example: '2025-06-01T00:00:00Z',
    nullable: true,
    description:
      'Pro early access deadline (24h after creation). Item is only visible to Pro subscribers until this time.',
  })
  proEarlyAccessUntil: Date | null;

  @ApiProperty({
    example: 142,
    description:
      'Cached unique-viewer count (deduped per user/anon per day). 0 if never viewed.',
  })
  viewCount: number;

  @ApiProperty({
    example: 12,
    description: 'Number of users currently watching this item.',
  })
  watcherCount: number;

  @ApiProperty({
    example: false,
    description:
      'True when the requesting user is currently watching this item. Always false for anonymous requests.',
  })
  isWatching: boolean;

  @ApiProperty({
    enum: PrizeSaleType,
    example: PrizeSaleType.FIXED_PRICE,
    description:
      'How this item is sold. `auction` items are bid-based and excluded from CadeCoin / redemptions.',
  })
  saleType: PrizeSaleType;

  @ApiProperty({
    example: 5,
    description:
      'Per-item shipping fee in USD. Added on top of bid + buyer processing fee at checkout / auction close.',
  })
  shippingCostUsd: number;

  @ApiProperty({
    example: false,
    description:
      'When true, the item is in-person pickup only — the storefront and checkout UIs hide shipping-address collection and shipping defaults to $0.00.',
  })
  isInPerson: boolean;

  @ApiProperty({
    type: () => AuctionSummaryDto,
    nullable: true,
    description: 'Present when saleType === auction.',
  })
  auction: AuctionSummaryDto | null;
}
/**
 * DTO for creating a new prize tier (admin only)
 */
export class CreatePrizeTierDto {
  @ApiProperty({
    example: 4,
    description: 'Prize tier number (auto-generated if not provided)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  prizeTier?: number;

  @ApiProperty({
    example: 250000,
    description:
      'Coin threshold for this tier (optional for offers_only, will default to 1)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiProperty({
    example: 'Legend',
    description: 'Display name for the prize tier',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'slab',
    description: 'Prize category: raw, slab, sealed or other',
    enum: ['raw', 'slab', 'sealed', 'other'],
    required: false,
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    example: 'NM',
    description: 'Grade/condition of the item',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString()
  grade?: string | null;

  @ApiProperty({
    example: 100,
    description: 'Stock quantity (0 = unlimited)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiProperty({
    example: 'both',
    description: 'Purchase option: offers only, buy only, or both',
    enum: PrizePurchaseOption,
    required: false,
  })
  @IsOptional()
  @IsEnum(PrizePurchaseOption)
  purchaseOption?: PrizePurchaseOption;

  @ApiProperty({
    example: 'pokemon',
    description: 'Prize brand: pokemon, one_piece, or sports',
    enum: PrizeBrand,
    required: false,
  })
  @IsOptional()
  @IsEnum(PrizeBrand)
  brand?: PrizeBrand;

  @ApiProperty({
    example: 'Reach 250,000 lifetime coins to unlock the Legend badge',
    description: 'Description of the prize',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'https://s3.amazonaws.com/...',
    description: 'URL to the prize thumbnail image',
    required: false,
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({
    example: ['uploads/items/1.png', 'uploads/items/2.png'],
    description:
      'Ordered image URLs for this item. Maximum 6 images. First image is cover unless coverImageIndex is provided.',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(6)
  imageUrls?: string[];

  @ApiProperty({
    example: 0,
    description: 'Cover image index within imageUrls (0-indexed)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  coverImageIndex?: number;

  @ApiProperty({
    example: 1,
    description:
      'Display order on shop page (1-indexed, auto-generated if not provided)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  displayOrderShop?: number;

  @ApiProperty({
    example: 1,
    description:
      'Display order on seller-specific shop page (1-indexed, optional)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  sellerDisplayOrderShop?: number;

  @ApiProperty({
    example: 1,
    description:
      'Display order on redemptions page (1-indexed, auto-generated if not provided)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  displayOrderRedemptions?: number;

  @ApiProperty({
    example: 1,
    description: 'Featured carousel display order (null = not featured)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  featuredDisplayOrder?: number | null;

  @ApiProperty({
    example: true,
    description: 'Whether to show this prize on the redemptions page',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showOnRedemptions?: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether to show this prize on the shop page',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showOnShop?: boolean;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description:
      'Seller user ID who created this prize (null for admin-created prizes)',
    required: false,
  })
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiProperty({
    example: false,
    description:
      'Whether this item is exclusive to CardCade Pro subscribers only',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isProOnly?: boolean;

  @ApiProperty({
    example: false,
    description:
      'Whether this item is featured on the seller profile page (Pro sellers only)',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  profileFeatured?: boolean;

  @ApiProperty({
    example: 'charizard psa 10',
    description:
      'Optional admin-controlled search phrase for sold-market data. If omitted, integrations should use item name.',
    required: false,
  })
  @IsOptional()
  @IsString()
  ebaySearchQuery?: string;

  @ApiProperty({
    enum: PrizeSaleType,
    example: PrizeSaleType.FIXED_PRICE,
    description:
      'How this item is sold. Set to `auction` to mark the item as auction-eligible (an auction must then be created via /admin/auctions).',
    required: false,
  })
  @IsOptional()
  @IsEnum(PrizeSaleType)
  saleType?: PrizeSaleType;

  @ApiProperty({
    example: 5,
    description:
      'Per-item shipping fee in USD. Defaults to $5 if omitted. Charged on top of the winning bid (auctions) or sale price (fixed/offers).',
    required: false,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shippingCostUsd?: number;

  @ApiProperty({
    example: false,
    description:
      'Mark this item as in-person pickup. Skips the shipping address requirement at checkout and zeroes the default shipping cost (sellers may still override). Defaults to false.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isInPerson?: boolean;
}
/**
 * Updates create a new row with is_active=true and set old row to is_active=false
 */
export class UpdatePrizeTierDto {
  @ApiProperty({
    example: 4,
    description: 'Prize tier number (will remain the same)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  prizeTier?: number;

  @ApiProperty({
    example: 250000,
    description:
      'Updated coin threshold (optional for offers_only, will default to 1)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiProperty({
    example: 'Legend',
    description: 'Updated display name',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'slab',
    description: 'Prize category: raw, slab, sealed or other',
    enum: ['raw', 'slab', 'sealed', 'other'],
    required: false,
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    example: 'NM',
    description: 'Grade/condition of the item',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString()
  grade?: string | null;

  @ApiProperty({
    example: 100,
    description: 'Stock quantity (0 = unlimited)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiProperty({
    example: 'both',
    description: 'Purchase option: offers only, buy only, or both',
    enum: PrizePurchaseOption,
    required: false,
  })
  @IsOptional()
  @IsEnum(PrizePurchaseOption)
  purchaseOption?: PrizePurchaseOption;

  @ApiProperty({
    example: 'pokemon',
    description: 'Prize brand: pokemon, one_piece, or sports',
    enum: PrizeBrand,
    required: false,
  })
  @IsOptional()
  @IsEnum(PrizeBrand)
  brand?: PrizeBrand;

  @ApiProperty({
    example: 'Reach 250,000 lifetime coins to unlock the Legend badge',
    description: 'Updated description',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'https://s3.amazonaws.com/...',
    description: 'Updated image URL',
    required: false,
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({
    example: ['uploads/items/1.png', 'uploads/items/2.png'],
    description: 'Updated ordered image URLs for this item. Maximum 6 images.',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(6)
  imageUrls?: string[];

  @ApiProperty({
    example: 1,
    description: 'Cover image index within imageUrls (0-indexed)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  coverImageIndex?: number;

  @ApiProperty({
    example: 1,
    description: 'Display order on shop page (1-indexed)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  displayOrderShop?: number;

  @ApiProperty({
    example: 1,
    description: 'Display order on seller-specific shop page (1-indexed)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  sellerDisplayOrderShop?: number;

  @ApiProperty({
    example: 1,
    description: 'Display order on redemptions page (1-indexed)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  displayOrderRedemptions?: number;

  @ApiProperty({
    example: 1,
    description: 'Featured carousel display order (null = not featured)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  featuredDisplayOrder?: number | null;

  @ApiProperty({
    example: true,
    description: 'Whether to show this prize on the redemptions page',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showOnRedemptions?: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether to show this prize on the shop page',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showOnShop?: boolean;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description:
      'Seller user ID who created this prize (null for admin-created prizes)',
    required: false,
  })
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiProperty({
    example: false,
    description:
      'Whether this item is exclusive to CardCade Pro subscribers only',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isProOnly?: boolean;

  @ApiProperty({
    example: false,
    description:
      'Whether this item is featured on the seller profile page (Pro sellers only)',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  profileFeatured?: boolean;

  @ApiProperty({
    example: 'charizard psa 10',
    description:
      'Optional admin-controlled search phrase for sold-market data. If omitted, existing value is preserved.',
    required: false,
  })
  @IsOptional()
  @IsString()
  ebaySearchQuery?: string;

  @ApiProperty({
    example: 5,
    description: 'Per-item shipping fee in USD.',
    required: false,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shippingCostUsd?: number;

  @ApiProperty({
    example: false,
    description:
      'Toggle in-person pickup mode. When true the storefront/checkout skip shipping address collection.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isInPerson?: boolean;

  /**
   * Sale type is immutable after creation — an item that was created as
   * an auction stays an auction (and vice-versa), so the update flow
   * intentionally ignores this value and preserves the existing tier's
   * `saleType`. We still accept it in the DTO because the seller and
   * admin edit forms include the field in their submit payload, and the
   * global ValidationPipe is configured with `forbidNonWhitelisted:
   * true` which would otherwise reject the entire request with 400.
   */
  @ApiProperty({
    enum: PrizeSaleType,
    example: PrizeSaleType.FIXED_PRICE,
    description:
      'Accepted for backwards compatibility with the edit forms; saleType is immutable after creation and the existing value is preserved.',
    required: false,
  })
  @IsOptional()
  @IsEnum(PrizeSaleType)
  saleType?: PrizeSaleType;
}

/**
 * DTO for public prize progress calculation response
 */
export class PrizeProgressDto {
  @ApiProperty({
    example: 500,
    description: 'Current lifetime coins earned',
  })
  lifetimeCoinsEarned: number;

  @ApiProperty({
    example: 5000,
    nullable: true,
    description: 'Next prize threshold amount, null if all prizes achieved',
  })
  nextPrize: number | null;

  @ApiProperty({
    example: 'Dealer',
    nullable: true,
    description: 'Next prize tier name, null if all prizes achieved',
  })
  nextPrizeName: string | null;

  @ApiProperty({
    example: 10,
    description: 'Progress percentage toward next prize (0-100)',
  })
  progressPercent: number;

  @ApiProperty({
    type: [PrizeItemDto],
    description: 'All available prizes with achievement status',
  })
  allPrizes: Array<PrizeItemDto & { achieved: boolean }>;
}

/**
 * DTO for prize redemption response
 */
export class PrizeRedemptionDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'uuid' })
  prizeConfigurationId: string;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  dateRedeemed: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00Z' })
  createdAt: Date;
}

/**
 * DTO for a single prize display order update
 */
export class PrizeDisplayOrderUpdateDto {
  @ApiProperty({
    example: 'uuid',
    description: 'Prize configuration ID',
  })
  @IsString()
  id: string;

  @ApiProperty({
    example: 1,
    description:
      'Display order on shop page (1-indexed, null if not shown on this page)',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  displayOrderShop: number | null;

  @ApiProperty({
    example: 1,
    description:
      'Display order on redemptions page (1-indexed, null if not shown on this page)',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  displayOrderRedemptions: number | null;

  @ApiProperty({
    example: 1,
    description: 'Featured carousel display order (null = not featured)',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  featuredDisplayOrder: number | null;

  @ApiProperty({
    example: false,
    description: 'Whether to sort shop page by purchase option (both first)',
  })
  @IsOptional()
  @IsBoolean()
  sortByPurchaseOptionShop?: boolean;

  @ApiProperty({
    example: false,
    description:
      'Whether to sort redemptions page by purchase option (both first)',
  })
  @IsOptional()
  @IsBoolean()
  sortByPurchaseOptionRedemptions?: boolean;
}

/**
 * DTO for bulk updating prize display orders
 */
export class BulkUpdateDisplayOrderDto {
  @ApiProperty({
    type: [PrizeDisplayOrderUpdateDto],
    description: 'Array of prize display order updates',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrizeDisplayOrderUpdateDto)
  updates: PrizeDisplayOrderUpdateDto[];
}
