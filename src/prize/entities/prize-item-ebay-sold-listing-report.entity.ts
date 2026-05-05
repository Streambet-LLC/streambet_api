import { Entity, Column, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { PrizeItemEbaySoldListing } from './prize-item-ebay-sold-listing.entity';
import { User } from '../../users/entities/user.entity';

export type EbaySoldListingReportStatus = 'pending' | 'approved' | 'rejected';

@Entity('prize_item_ebay_sold_listing_reports')
export class PrizeItemEbaySoldListingReport extends BaseEntity {
  @Column({ type: 'uuid', name: 'listing_id' })
  listingId: string;

  @ManyToOne(() => PrizeItemEbaySoldListing, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing: PrizeItemEbaySoldListing;

  @Column({ type: 'uuid', name: 'reporter_user_id' })
  reporterUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporter_user_id' })
  reporterUser: User;

  @Column({ type: 'text', name: 'reason', nullable: true })
  reason: string | null;

  @Column({
    type: 'varchar',
    name: 'status',
    length: 32,
    default: 'pending',
  })
  status: EbaySoldListingReportStatus;

  @Column({ type: 'timestamp', name: 'resolved_at', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'uuid', name: 'resolved_by_user_id', nullable: true })
  resolvedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by_user_id' })
  resolvedByUser: User | null;

  @Column({ type: 'text', name: 'resolution_note', nullable: true })
  resolutionNote: string | null;
}
