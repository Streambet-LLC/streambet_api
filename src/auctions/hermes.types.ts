import { AuctionStatus } from '../prize/enums/auction-status.enum';

/** How a bid is funded, and therefore how the winner pays at close. */
export type AuctionFundingMethod = 'card' | 'ach' | 'usdc';
export const FUNDING_METHODS: AuctionFundingMethod[] = ['card', 'ach', 'usdc'];

/** Which payment rails an auction accepts. Fiat = card + bank (ACH). */
export type AcceptedPayments = 'fiat' | 'crypto' | 'both';
export const ACCEPTED_PAYMENTS: AcceptedPayments[] = ['fiat', 'crypto', 'both'];

export function methodsFor(accepted: AcceptedPayments): AuctionFundingMethod[] {
  if (accepted === 'fiat') return ['card', 'ach'];
  if (accepted === 'crypto') return ['usdc'];
  return FUNDING_METHODS;
}

/** Admin-facing review buckets. Bidders only ever see live + upcoming. */
export type AuctionBucket = 'live' | 'upcoming' | 'settled';

export const BUCKET_STATUSES: Record<AuctionBucket, AuctionStatus[]> = {
  upcoming: [AuctionStatus.SCHEDULED],
  live: [AuctionStatus.ACTIVE],
  settled: [
    AuctionStatus.ENDED,
    AuctionStatus.PAID,
    AuctionStatus.UNSOLD,
    AuctionStatus.FAILED,
    AuctionStatus.CANCELLED,
  ],
};

export function bucketForStatus(status: AuctionStatus): AuctionBucket {
  if (status === AuctionStatus.SCHEDULED) return 'upcoming';
  if (status === AuctionStatus.ACTIVE) return 'live';
  return 'settled';
}

export type AuctionLengthPreset = '7' | '14' | '21' | 'custom';

export interface AuctionImage {
  /** S3 object key (for deletes / re-signing). */
  key: string;
  url: string;
}

export interface AuctionVideo {
  /** `upload` = our S3; `youtube` / `vimeo` = external embed. */
  kind: 'upload' | 'youtube' | 'vimeo';
  /** Playable URL (S3 object) or the original external link. */
  url: string;
  /** Iframe-safe embed URL for external providers. */
  embedUrl?: string;
  key?: string;
}

export interface ShippingAddressSnapshot {
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface EstValueComp {
  title: string | null;
  priceUsd: number;
  date: string | null;
  url: string | null;
  source: string | null;
}

/** Snapshot of a "pull it for me" recommendation, kept for audit. */
export interface EstValueMeta {
  subject: string;
  pointUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  confidencePct: number | null;
  reliability: string | null;
  method: string | null;
  comps: EstValueComp[];
  note: string | null;
  pulledAt: string;
}

export type FulfillmentStatus = 'pending' | 'shipped' | 'delivered';
