import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { SPORTS } from '../sports-derivation.util';

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
 * Canonical collector personas. The admin "Persona override" field is a
 * single-select over these (it replaced a free-text input). Stored verbatim
 * on `analytics_profile.personaOverride`.
 */
export const COLLECTOR_PERSONAS = [
  'Institution',
  'Pro Dealer',
  'Amateur Dealer',
  'Short Holder / Flipper',
  'Long Holder / Collector',
  'Hybrid - Long / Short',
  'Creator / Influencer',
  'Card Fund Manager',
] as const;

export type CollectorPersona = (typeof COLLECTOR_PERSONAS)[number];

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

  @ApiPropertyOptional({
    description:
      'Stable id for analytics-only entries (allows multiple per platform).',
  })
  id?: string;

  @ApiPropertyOptional({
    description:
      'Optional admin-supplied label (e.g. "Personal", "Shop", "Pokémon-only").',
  })
  label?: string;

  @ApiProperty({
    enum: ['public', 'analytics'],
    description:
      '`public` comes from `users.socials` (one per platform, visible on the user’s profile/shop). `analytics` is admin-curated, allows multiple per platform, and never leaks to the public profile unless explicitly mirrored.',
  })
  source: 'public' | 'analytics';
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
    description:
      'Heuristic forecast of USD this buyer will spend in the next 30 days: ' +
      'recent monthly run-rate (trailing 90d / 3) decayed by days since last ' +
      'purchase. Buy-side only, so sellers who also buy sealed get a value. ' +
      '0 when there is no purchase history.',
  })
  predicted30dSpendUsd: number;

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

  @ApiProperty({
    nullable: true,
    required: false,
    description:
      'Admin-set persona label (analytics_profile.personaOverride). Null when no persona has been assigned.',
  })
  persona: string | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description:
      'Admin-set affiliation/group (analytics_profile.affiliation). Null when the collector has no affiliation.',
  })
  affiliation: string | null;

  @ApiProperty({
    description:
      'True when an admin has omitted this user from the Analytics surface (analytics_profile.excludedFromAnalytics). Omitted users are hidden from the list unless includeOmitted is set.',
  })
  excluded: boolean;

  @ApiProperty({
    nullable: true,
    required: false,
    description:
      'Centralized metropolitan area derived from the user-supplied city/state/zip (suburbs roll up to the nearest metro). Null when no usable location is on file.',
  })
  location: string | null;

  @ApiProperty({
    nullable: true,
    required: false,
    enum: ['High', 'Medium', 'Low'],
    description:
      'Rough buyer-volume guesstimate from lifetime spend (High/Medium/Low). Null for non-buyers.',
  })
  volume: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Preferred sports for Sports-category collectors (admin tags, else all auto-derived from purchases, most-bought first). Empty otherwise.',
  })
  preferredSports: string[];

  @ApiProperty({
    type: [String],
    description:
      'Preferred teams for Sports-category collectors (admin tags, else auto-derived from purchases, most-bought first). Empty otherwise.',
  })
  preferredTeams: string[];

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

  @ApiProperty({
    enum: ['card', 'us_bank_account'],
    required: false,
    nullable: true,
    description:
      'Stripe Checkout method used (card vs us_bank_account / ACH). Only meaningful for usd/combined orders; null otherwise.',
  })
  stripePaymentMethod: 'card' | 'us_bank_account' | null;

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

  @ApiPropertyOptional({
    description:
      'Free-form admin-injected analytics annotations (notes, tags, persona override, interests, etc.). Consumed by the future AI integration.',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  analyticsProfile?: AnalyticsProfileAnnotations | null;
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
    description:
      'Sum of every buyer’s heuristic predicted next-30-day spend (same ' +
      'run-rate × recency-decay formula as the per-collector figure). ' +
      'Forward-looking companion to spend30dUsd, which is the actual.',
  })
  predicted30dSpendUsd: number;

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

// ---------------------------------------------------------------------------
// Admin write DTOs (collector socials + analytics annotations)
// ---------------------------------------------------------------------------

const SUPPORTED_SOCIAL_PLATFORMS: AnalyticsSocialPlatform[] = [
  'instagram',
  'twitter',
  'tiktok',
  'youtube',
  'facebook',
  'twitch',
  'ebay',
];

/**
 * A single analytics social entry. Unlike `users.socials` (a one-per-platform
 * map), multiple entries per platform are allowed so admins can capture e.g.
 * a personal Instagram + a shop Instagram + a Pokémon-only Instagram on the
 * same collector.
 */
export class UpdateCollectorSocialEntryDto {
  @ApiPropertyOptional({
    description: 'Stable id for an existing entry. Omit when adding a new row.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiProperty({ enum: SUPPORTED_SOCIAL_PLATFORMS })
  @IsIn(SUPPORTED_SOCIAL_PLATFORMS)
  platform: AnalyticsSocialPlatform;

  @ApiProperty({
    description: 'Handle, full URL, or empty string. Empty rows are dropped.',
    example: '@cardcade',
  })
  @IsString()
  @MaxLength(255)
  value: string;

  @ApiPropertyOptional({
    description: 'Optional admin label (e.g. "Personal", "Shop").',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;
}

/**
 * Replace the user's **analytics** socials (stored on
 * `analytics_profile.socials`) with the supplied entries. Multiple entries
 * per platform are allowed.
 *
 * When `applyToPublic` is true the canonical public map (`users.socials`,
 * which feeds the user's profile + shop pages) is also overwritten using the
 * **first** entry per platform. When false (default) the public profile is
 * left untouched and analytics edits stay admin-only.
 */
export class UpdateCollectorSocialsDto {
  @ApiProperty({ type: [UpdateCollectorSocialEntryDto] })
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => UpdateCollectorSocialEntryDto)
  entries: UpdateCollectorSocialEntryDto[];

  @ApiPropertyOptional({
    description:
      'When true, also overwrite the public `users.socials` map (one per platform, last wins) so the changes surface on the user’s profile/shop. Defaults to false (analytics-only).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  applyToPublic?: boolean;
}

/**
 * Loose shape for admin-injected analytics annotations. Anything outside
 * these documented fields is dropped server-side to keep the column tidy.
 */
export interface AnalyticsProfileAnnotations {
  /** Internal display name override (admin notes only). */
  displayName?: string;
  /** Short bio summary admins maintain about the collector. */
  bio?: string;
  /** Persona override label (e.g. "Whale Collector"). */
  personaOverride?: string;
  /**
   * Affiliation / group this collector belongs to (e.g. a shop, league,
   * breaker team, Discord, or org). Optional — many collectors have none,
   * so this is frequently absent (treated as null downstream).
   */
  affiliation?: string;
  /**
   * When true, this user is omitted from the admin Analytics surface (hidden
   * from the collector list by default). Analytics-only — it does NOT touch
   * the user's account, login, or shop. Only stored when true.
   */
  excludedFromAnalytics?: boolean;
  /**
   * Admin override for the Sports sub-category. When set, these win over the
   * value auto-derived from the collector's sports purchases. `preferredTeams`
   * is free text; `preferredSports` is a list, each one of {@link SPORTS}.
   */
  preferredSports?: string[];
  preferredTeams?: string[];
  /** Free-form interest tags ("vintage", "graded", "1st-edition"). */
  interests?: string[];
  /** Buyer preferences / brands ("PSA10", "japanese", "sealed"). */
  preferences?: string[];
  /** Loose JSON of any custom KV pairs admins want to track. */
  customAttributes?: Record<string, string>;
  /** Internal notes only visible to admins. */
  notes?: string;
  /**
   * Admin-curated socials. Allows multiple per platform (e.g. a personal
   * IG + a shop IG) and is independent from `users.socials` so analytics
   * edits don't leak to the public profile by default.
   */
  socials?: AnalyticsProfileSocialEntry[];
  /** ISO timestamp of the last admin edit; managed server-side. */
  lastEditedAt?: string;
  /** Admin user id that last edited; managed server-side. */
  lastEditedBy?: string;
}

export interface AnalyticsProfileSocialEntry {
  id: string;
  platform: AnalyticsSocialPlatform;
  /** Raw value the admin entered (handle or URL). */
  value: string;
  /** Optional label like "Personal", "Shop", "Pokémon-only". */
  label?: string;
}

export class UpdateCollectorAnalyticsProfileDto
  implements AnalyticsProfileAnnotations
{
  @ApiPropertyOptional({ description: 'Internal display name override.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ description: 'Short bio summary.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({
    description: 'Persona (single-select). Empty string clears it.',
    enum: COLLECTOR_PERSONAS,
  })
  @IsOptional()
  @IsIn([...COLLECTOR_PERSONAS, ''])
  personaOverride?: string;

  @ApiPropertyOptional({
    description:
      'Affiliation / group label (e.g. a shop, league, or org). Optional.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  affiliation?: string;

  @ApiPropertyOptional({
    type: [String],
    enum: SPORTS,
    description:
      'Preferred sports override (multi-select). Empty array reverts to auto-derived.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SPORTS.length)
  @IsIn([...SPORTS], { each: true })
  preferredSports?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Preferred teams override (free text, multiple). Empty array reverts to auto-derived.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  preferredTeams?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Free-form interest tags.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  interests?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Buyer preferences / brands.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  preferences?: string[];

  @ApiPropertyOptional({
    description: 'Custom KV pairs admins want to track.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  customAttributes?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Internal admin-only notes.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  notes?: string;
}

/**
 * Toggle whether a user is omitted from the admin Analytics surface. This is
 * analytics-only — it never affects the user's account, login, or shop.
 */
export class SetCollectorExclusionDto {
  @ApiProperty({
    description:
      'True to omit (hide) the user from the Analytics list; false to restore them.',
  })
  @IsBoolean()
  excluded: boolean;
}

/**
 * Create a brand-new collector profile from the admin Analytics surface.
 *
 * Backs a real `users` row (so the new profile shows up in the list and can
 * be annotated like any other), but it is not a login-capable account: a
 * random password is generated server-side and the record is flagged as
 * admin-created. `username` + `email` are the only hard requirements; every
 * other field maps onto the same analytics annotations / socials that the
 * edit dialog manages.
 */
export class CreateCollectorProfileDto {
  @ApiPropertyOptional({
    description:
      'Optional unique username. Auto-generated server-side when omitted.',
    example: 'cardcade_whale',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      'Username can only contain alphanumeric characters, underscores, and hyphens',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  username?: string;

  @ApiPropertyOptional({
    description:
      'Optional unique email. A placeholder is generated server-side when omitted.',
    example: 'whale@example.com',
  })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string),
  )
  email?: string;

  @ApiPropertyOptional({ description: 'Display name / real name.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ description: 'Short bio summary.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({
    description: 'Persona (single-select).',
    enum: COLLECTOR_PERSONAS,
  })
  @IsOptional()
  @IsIn([...COLLECTOR_PERSONAS, ''])
  personaOverride?: string;

  @ApiPropertyOptional({
    description:
      'Affiliation / group label (e.g. a shop, league, or org). Optional.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  affiliation?: string;

  @ApiPropertyOptional({
    type: [String],
    enum: SPORTS,
    description: 'Preferred sports (multi-select). Optional.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SPORTS.length)
  @IsIn([...SPORTS], { each: true })
  preferredSports?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Preferred teams (free text, multiple). Optional.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  preferredTeams?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Free-form interest tags.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  interests?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Buyer preferences / brands.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  preferences?: string[];

  @ApiPropertyOptional({
    description: 'Custom KV pairs admins want to track.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  customAttributes?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Internal admin-only notes.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  notes?: string;

  @ApiPropertyOptional({
    type: [UpdateCollectorSocialEntryDto],
    description:
      'Optional analytics socials to seed (multiple per platform allowed).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => UpdateCollectorSocialEntryDto)
  socials?: UpdateCollectorSocialEntryDto[];

  @ApiPropertyOptional({
    description:
      'When true, also write the seeded socials onto the public `users.socials` map (one per platform). Defaults to false.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  applyToPublic?: boolean;
}
