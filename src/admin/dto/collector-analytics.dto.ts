import { ApiProperty } from '@nestjs/swagger';

/**
 * Maps the canonical PrizeBrand enum to the four "asset categories" the
 * Analytics UI groups behavior around. Anything we can't classify falls
 * back to `other` so chart denominators stay correct.
 */
export type AnalyticsAssetCategory =
  | 'pokemon'
  | 'one_piece'
  | 'sports'
  | 'other';

/**
 * Social handles we can surface today come from `users.socials` (jsonb)
 * which the seller onboarding flow populates. Keys are normalized to the
 * Analytics UI's `SocialPlatform` vocabulary.
 */
export type AnalyticsSocialPlatform =
  | 'instagram'
  | 'twitter'
  | 'tiktok'
  | 'youtube'
  | 'facebook'
  | 'twitch'
  | 'ebay';

export class CollectorSocialDto {
  @ApiProperty({
    enum: [
      'instagram',
      'twitter',
      'tiktok',
      'youtube',
      'facebook',
      'twitch',
      'ebay',
    ],
  })
  platform: AnalyticsSocialPlatform;

  @ApiProperty({
    description: 'Handle as the seller entered it (no leading @, best-effort).',
  })
  handle: string;

  @ApiProperty({ description: 'Best-guess profile URL.' })
  url: string;
}

export class CollectorCategorySpendDto {
  @ApiProperty({ enum: ['pokemon', 'one_piece', 'sports', 'other'] })
  category: AnalyticsAssetCategory;

  @ApiProperty({ description: 'USD spend in this category (all-time, paid+).' })
  spendUsd: number;

  @ApiProperty({
    description: 'Number of paid orders in this category (all-time).',
  })
  orderCount: number;
}

export class CollectorProfileSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ description: 'ISO date of account creation.' })
  joinedAt: string;

  @ApiProperty()
  isSeller: boolean;

  @ApiProperty({
    description: 'Lifetime USD spend on paid/shipped/delivered orders.',
  })
  lifetimeSpendUsd: number;

  @ApiProperty({ description: 'USD spend in the trailing 30 days (paid+).' })
  last30dSpendUsd: number;

  @ApiProperty({
    description: 'Total number of paid/shipped/delivered purchase orders.',
  })
  purchaseCount: number;

  @ApiProperty({
    description:
      'Total number of sales (orders where this user is the seller).',
  })
  saleCount: number;

  @ApiProperty({
    description: 'Lifetime USD revenue on items sold by this user (paid+).',
  })
  lifetimeSalesUsd: number;

  @ApiProperty({
    description:
      'ISO date of last paid order placed by this user (buyer side).',
    required: false,
    nullable: true,
  })
  lastPurchaseAt: string | null;

  @ApiProperty({
    type: [String],
    enum: ['pokemon', 'one_piece', 'sports', 'other'],
  })
  topCategories: AnalyticsAssetCategory[];

  @ApiProperty({ type: [CollectorSocialDto] })
  socials: CollectorSocialDto[];
}

export class CollectorOrderEventDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['purchase', 'sale'] })
  kind: 'purchase' | 'sale';

  @ApiProperty()
  at: string;

  @ApiProperty()
  prizeName: string;

  @ApiProperty({ enum: ['pokemon', 'one_piece', 'sports', 'other'] })
  category: AnalyticsAssetCategory;

  @ApiProperty({ description: 'USD amount on the order (totalPrice).' })
  amountUsd: number;

  @ApiProperty({ enum: ['coins', 'usd', 'combined', 'crypto'] })
  paymentMethod: 'coins' | 'usd' | 'combined' | 'crypto';

  @ApiProperty()
  status: string;

  @ApiProperty({ required: false, nullable: true })
  counterpartyUsername: string | null;
}

export class CollectorProfileDetailDto extends CollectorProfileSummaryDto {
  @ApiProperty({ type: [CollectorCategorySpendDto] })
  categoryBreakdown: CollectorCategorySpendDto[];

  @ApiProperty({ type: [CollectorOrderEventDto] })
  recentOrders: CollectorOrderEventDto[];
}

export class CollectorOverviewCategoryDto {
  @ApiProperty({ enum: ['pokemon', 'one_piece', 'sports', 'other'] })
  category: AnalyticsAssetCategory;

  @ApiProperty()
  label: string;

  @ApiProperty({
    description: 'USD spent on paid/shipped/delivered orders, last 30d.',
  })
  spendUsd: number;

  @ApiProperty({ description: 'Distinct buyers in the last 30d.' })
  userCount: number;
}

export class CollectorOverviewTopAssetDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['pokemon', 'one_piece', 'sports', 'other'] })
  category: AnalyticsAssetCategory;

  @ApiProperty({ description: 'Distinct buyers (last 30d).' })
  buyers: number;

  @ApiProperty({ description: 'Units sold (last 30d).' })
  unitsSold: number;

  @ApiProperty({ description: 'Total USD revenue (last 30d).' })
  revenueUsd: number;
}

export class CollectorOverviewSpendWeekDto {
  @ApiProperty({ description: 'Week start date (UTC, ISO).' })
  weekStart: string;

  @ApiProperty({ description: 'Label like "W12" for chart axes.' })
  label: string;

  @ApiProperty({ description: 'Total paid USD that week.' })
  spendUsd: number;

  @ApiProperty({ description: 'Distinct buyers that week.' })
  buyers: number;
}

export class CollectorAnalyticsOverviewDto {
  @ApiProperty()
  totalProfiles: number;

  @ApiProperty({
    description:
      'Profiles that placed at least one paid order in the last 30 days.',
  })
  activeBuyers30d: number;

  @ApiProperty({
    description:
      'Profiles that fulfilled at least one paid order in the last 30 days.',
  })
  activeSellers30d: number;

  @ApiProperty({
    description: 'Sum of paid order USD across all categories, last 30 days.',
  })
  spend30dUsd: number;

  @ApiProperty({
    description: 'Sum of paid order USD across all categories, all-time.',
  })
  lifetimeSpendUsd: number;

  @ApiProperty({ type: [CollectorOverviewCategoryDto] })
  categoryAffinity: CollectorOverviewCategoryDto[];

  @ApiProperty({ type: [CollectorOverviewTopAssetDto] })
  topAssets: CollectorOverviewTopAssetDto[];

  @ApiProperty({ type: [CollectorOverviewSpendWeekDto] })
  spendTrend: CollectorOverviewSpendWeekDto[];
}
